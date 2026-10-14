"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { requireBuyer } from "@/server/auth/guards";
import { getConnectedSupplier } from "@/server/domain/buyer/catalog";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { submitInputSchema, submitOrder, type SubmitError } from "@/server/domain/orders/submit";

export type SubmitActionResult =
  | { ok: false; error: SubmitError | "invalid" | "unknown"; fieldErrors?: Record<string, ValidationKey> }
  | { ok: false; error: "changed"; changes: string[] };

export async function submitOrderAction(supplierOrgId: string, raw: unknown): Promise<SubmitActionResult> {
  const ctx = await requireBuyer();
  const parsed = submitInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };

  let orderId: string;
  try {
    const result = await submitOrder(ctx, supplierOrgId, parsed.data);
    if (result.status === "changed") {
      // Formatted here, on the server: clients never format money.
      const t = await getTranslations("checkout.change");
      const { currency } = await getConnectedSupplier(ctx, supplierOrgId);
      return {
        ok: false,
        error: "changed",
        changes: result.changes.map((c) =>
          t(c.kind, {
            name: c.name,
            before: c.before !== undefined ? formatMoney(c.before, currency) : "",
            after: c.after !== undefined ? formatMoney(c.after, currency) : "",
          }),
        ),
      };
    }
    orderId = result.orderId;
  } catch (error) {
    if (error instanceof StateError) return { ok: false, error: error.code as SubmitError };
    if (error instanceof NotFoundError) return { ok: false, error: "supplier_unavailable" };
    console.error("[checkout] submit failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "unknown" };
  }
  redirect(`/buyer/orders/${orderId}?placed=1`);
}
