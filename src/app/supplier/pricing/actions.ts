"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { priceImportMappingSchema, rawSheetSchema } from "@/lib/catalog/import";
import { parseMoneyInput } from "@/lib/money";
import { parsePercentInput } from "@/lib/pricing/conditions";
import { parseQuantityInput } from "@/lib/quantity";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import {
  analyzePriceImport,
  commitPriceImport,
  type PriceImportAnalysis,
  type PriceImportError,
} from "@/server/domain/pricing/price-import";
import {
  applyBulkDiscount,
  createPriceList,
  deletePriceList,
  parseDiscountPercent,
  previewBulkDiscount,
  priceListNameSchema,
  renamePriceList,
  setDefaultPriceList,
  setAllListItems,
  setListItems,
  copyPriceList,
  type BulkPreview,
  type PriceListError,
} from "@/server/domain/pricing/price-lists";
import { saveScopeRules, type ConditionsError, type RuleInput } from "@/server/domain/pricing/conditions";
import { decideTermsRequest, clearCustomerTerms } from "@/server/domain/pricing/conditions";
import { getFormats } from "@/server/i18n/formats";

type Code = PriceListError | PriceImportError | "required" | "too_long";
type Err = ActionError<Code>;
const id = z.uuid();

function nameError(raw: string): Err | null {
  const parsed = priceListNameSchema.safeParse(raw);
  if (parsed.success) return null;
  return { ok: false, error: parsed.error.issues[0]?.message === "too_long" ? "too_long" : "required" };
}

export async function createPriceListAction(name: string): Promise<Err> {
  const ctx = await requireSupplier();
  const invalid = nameError(name);
  if (invalid) return invalid;
  let newId: string | null = null;
  const result = await runAction<{ ok: true }, Code>("createPriceList", async () => {
    newId = await createPriceList(ctx, name);
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect(`/supplier/pricing/${newId}`);
}

export async function renamePriceListAction(priceListId: string, name: string): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  const invalid = nameError(name);
  if (invalid) return invalid;
  if (!id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, Code>("renamePriceList", async () => {
    await renamePriceList(ctx, priceListId, name);
    refresh();
    return { ok: true };
  });
}

export async function setDefaultPriceListAction(priceListId: string, makeDefault: boolean): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, Code>("setDefaultPriceList", async () => {
    await setDefaultPriceList(ctx, makeDefault ? priceListId : null);
    refresh();
    return { ok: true };
  });
}

export async function deletePriceListAction(priceListId: string): Promise<Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  const result = await runAction<{ ok: true }, Code>("deletePriceList", async () => {
    await deletePriceList(ctx, priceListId);
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect("/supplier/pricing");
}

const itemsSchema = z
  .array(z.object({ productId: z.uuid(), included: z.boolean(), price: z.string().max(32) }))
  .min(1)
  .max(500);

/** Ticked + empty price = available at the base price; unticked = not available. */
export async function saveItemsAction(
  priceListId: string,
  raw: unknown,
): Promise<{ ok: true } | Err | { ok: false; error: "invalid"; invalidProductIds: string[] }> {
  const ctx = await requireSupplier();
  const parsed = itemsSchema.safeParse(raw);
  if (!parsed.success || !id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  const changes = parsed.data.map((c) => {
    const blank = c.price.trim() === "";
    const priceMinor = !c.included || blank ? null : parseMoneyInput(c.price);
    return { productId: c.productId, included: c.included, priceMinor, bad: c.included && !blank && priceMinor === null };
  });
  const invalidProductIds = changes.filter((c) => c.bad).map((c) => c.productId);
  if (invalidProductIds.length) return { ok: false, error: "invalid", invalidProductIds };
  return runAction<{ ok: true }, Code>("saveItems", async () => {
    await setListItems(ctx, priceListId, changes.map(({ productId, included, priceMinor }) => ({ productId, included, priceMinor })));
    refresh();
    return { ok: true };
  });
}

const filtersSchema = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.string().max(40).optional(),
  activeOnly: z.boolean().optional(),
});

/** "Tick all" / "untick all" for everything matching the current search and category. */
export async function setAllItemsAction(
  priceListId: string,
  include: boolean,
  rawFilters: unknown,
): Promise<{ ok: true; count: number } | Err> {
  const ctx = await requireSupplier();
  const filters = filtersSchema.safeParse(rawFilters);
  if (!filters.success || !id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; count: number }, Code>("setAllItems", async () => {
    const count = await setAllListItems(ctx, priceListId, include, filters.data);
    refresh();
    return { ok: true, count };
  });
}

export async function copyPriceListAction(priceListId: string, name: string): Promise<Err> {
  const ctx = await requireSupplier();
  const invalid = nameError(name);
  if (invalid) return invalid;
  if (!id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  let newId: string | null = null;
  const result = await runAction<{ ok: true }, Code>("copyPriceList", async () => {
    newId = await copyPriceList(ctx, priceListId, name);
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect(`/supplier/pricing/${newId}`);
}

export type BulkPreviewView = {
  count: number;
  /** Formatted on the server so every browser shows the same format. */
  sample: { name: string; base: string; next: string }[];
};

export async function previewBulkAction(
  priceListId: string,
  percent: string,
): Promise<{ ok: true; preview: BulkPreviewView; discountBp: number } | Err> {
  const fmt = await getFormats();
  const ctx = await requireSupplier();
  const discountBp = parseDiscountPercent(percent);
  if (discountBp === null) return { ok: false, error: "invalid_discount" };
  if (!id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; preview: BulkPreviewView; discountBp: number }, Code>("previewBulk", async () => {
    const [preview, settings]: [BulkPreview, Awaited<ReturnType<typeof getSupplierSettings>>] = await Promise.all([
      previewBulkDiscount(ctx, priceListId, discountBp),
      getSupplierSettings(ctx),
    ]);
    return {
      ok: true,
      discountBp,
      preview: {
        count: preview.count,
        sample: preview.sample.map((s) => ({
          name: s.name,
          base: fmt.money(s.basePriceMinor, settings.currency),
          next: fmt.money(s.newPriceMinor, settings.currency),
        })),
      },
    };
  });
}

export async function applyBulkAction(priceListId: string, discountBp: number): Promise<{ ok: true; count: number } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(priceListId).success || !Number.isInteger(discountBp)) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; count: number }, Code>("applyBulk", async () => {
    const count = await applyBulkDiscount(ctx, priceListId, discountBp);
    refresh();
    return { ok: true, count };
  });
}

const importPayload = z.object({ sheet: rawSheetSchema, mapping: priceImportMappingSchema });

export async function analyzePriceImportAction(priceListId: string, raw: unknown): Promise<{ ok: true; analysis: PriceImportAnalysis } | Err> {
  const ctx = await requireSupplier();
  const parsed = importPayload.safeParse(raw);
  if (!parsed.success || !id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; analysis: PriceImportAnalysis }, Code>("analyzePriceImport", async () => ({
    ok: true,
    analysis: await analyzePriceImport(ctx, priceListId, parsed.data.sheet, parsed.data.mapping),
  }));
}

export async function commitPriceImportAction(
  priceListId: string,
  raw: unknown,
): Promise<{ ok: true; result: { updated: number; skipped: number } } | Err> {
  const ctx = await requireSupplier();
  const parsed = importPayload.extend({ mode: z.enum(["all", "valid_only"]) }).safeParse(raw);
  if (!parsed.success || !id.safeParse(priceListId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; result: { updated: number; skipped: number } }, Code>("commitPriceImport", async () => {
    const result = await commitPriceImport(ctx, priceListId, parsed.data.sheet, parsed.data.mapping, parsed.data.mode);
    refresh();
    return { ok: true, result };
  });
}

const conditionRowsSchema = z
  .array(
    z.object({
      kind: z.enum(["method", "interval", "qty"]),
      method: z.string().max(16).nullable().optional(),
      intervalDays: z.number().int().nullable().optional(),
      qty: z.string().max(16).nullable().optional(),
      pct: z.string().max(12),
    }),
  )
  .max(40);

/** Saves the conditions of one scope: the whole list (productId null) or one product on it. */
export async function saveConditionsAction(
  priceListId: string,
  productId: string | null,
  raw: unknown,
): Promise<{ ok: true } | ActionError<ConditionsError | "invalid">> {
  const ctx = await requireSupplier();
  const parsed = conditionRowsSchema.safeParse(raw);
  if (!parsed.success || !id.safeParse(priceListId).success || (productId !== null && !id.safeParse(productId).success)) {
    return { ok: false, error: "invalid" };
  }
  const rows: RuleInput[] = [];
  for (const r of parsed.data) {
    const adjustBp = parsePercentInput(r.pct);
    if (adjustBp === null) return { ok: false, error: "invalid_rule" };
    if (r.kind === "qty") {
      const minQtyMilli = r.qty ? parseQuantityInput(r.qty) : null;
      if (!minQtyMilli) return { ok: false, error: "invalid_rule" };
      rows.push({ kind: "qty", minQtyMilli, adjustBp });
    } else if (r.kind === "method") {
      rows.push({ kind: "method", method: r.method ?? null, adjustBp });
    } else {
      rows.push({ kind: "interval", intervalDays: r.intervalDays ?? null, adjustBp });
    }
  }
  return runAction<{ ok: true }, ConditionsError | "invalid">("saveConditions", async () => {
    await saveScopeRules(ctx, priceListId, productId, rows);
    refresh();
    return { ok: true };
  });
}

/** The supplier approves or declines a customer's request to pay another way. */
export async function decideTermsAction(requestId: string, approve: boolean): Promise<{ ok: true } | ActionError<ConditionsError | "invalid">> {
  const ctx = await requireSupplier();
  if (!id.safeParse(requestId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ConditionsError | "invalid">("decideTerms", async () => {
    await decideTermsRequest(ctx, requestId, approve);
    refresh();
    return { ok: true };
  });
}

/** Back to the standard price for one customer. */
export async function clearTermsAction(buyerOrgId: string): Promise<{ ok: true } | ActionError<ConditionsError | "invalid">> {
  const ctx = await requireSupplier();
  if (!id.safeParse(buyerOrgId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ConditionsError | "invalid">("clearTerms", async () => {
    await clearCustomerTerms(ctx, buyerOrgId);
    refresh();
    return { ok: true };
  });
}
