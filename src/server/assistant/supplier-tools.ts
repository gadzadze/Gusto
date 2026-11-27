import "server-only";
import { and, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import type { OrderSnap, ToolResult } from "@/lib/assistant/snapshots";
import { getDb } from "@/server/db/client";
import { orders, organizations, type OrderStatus } from "@/server/db/schema";
import { listSupplierProducts, getSupplierProduct } from "@/server/domain/catalog/products";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { listCustomers } from "@/server/domain/customers/customers";
import { getOrder, listSupplierOrders } from "@/server/domain/orders/queries";
import { getPickList } from "@/server/domain/orders/pick-list";
import { getSupplierClock, listPendingQueue } from "@/server/domain/orders/today";
import { getFormats } from "@/server/i18n/formats";

// What the assistant can look up and propose for a supplier. Lookups read through the same domain functions the supplier's pages use,
// scoped by the signed-in supplier's context. Proposals only draw a card; the change itself happens when the supplier taps Confirm
// (see supplier-actions.ts).

export const SUPPLIER_TOOLS = [
  "list_pending_orders",
  "list_orders",
  "get_order",
  "list_customers",
  "find_products",
  "loading_sheet",
  "propose_confirm_orders",
  "propose_reject_order",
  "propose_mark_delivered",
  "propose_set_active",
  "propose_set_price",
  "show_choices",
] as const;
export type SupplierTool = (typeof SUPPLIER_TOOLS)[number];

const MAX_ROWS = 20;
const numbers = z.array(z.coerce.number().int().positive()).min(1).max(20);

const schemas = {
  list_pending_orders: z.object({}),
  list_orders: z.object({ tab: z.enum(["new", "confirmed", "done"]).default("confirmed") }),
  get_order: z.object({ number: z.coerce.number().int().positive() }),
  list_customers: z.object({}),
  find_products: z.object({ query: z.string().trim().max(100).optional(), restock_only: z.boolean().optional(), hidden_only: z.boolean().optional() }),
  loading_sheet: z.object({ day: z.string().trim().min(1).max(12).default("today") }),
  propose_confirm_orders: z.object({ numbers }),
  propose_reject_order: z.object({ number: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
  propose_mark_delivered: z.object({ numbers }),
  propose_set_active: z.object({ product_ids: z.array(z.string().uuid()).min(1).max(50), active: z.boolean() }),
  propose_set_price: z.object({ product_id: z.string().uuid(), price: z.coerce.number().min(0).max(1_000_000) }),
  show_choices: z.object({ question: z.string().trim().min(1).max(200), options: z.array(z.string().trim().min(1).max(80)).min(2).max(5) }),
};

export async function runSupplierTool(ctx: OrgCtx, name: string, args: unknown): Promise<ToolResult> {
  if (ctx.orgType !== "supplier") throw new NotFoundError();
  if (!(SUPPLIER_TOOLS as readonly string[]).includes(name)) return { ok: false, error: "unknown_tool" };
  const tool = name as SupplierTool;
  const parsed = schemas[tool].safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: "invalid_arguments" };
  const a = parsed.data as never as Record<string, never>;
  try {
    switch (tool) {
      case "list_pending_orders":
        return await pendingOrders(ctx);
      case "list_orders":
        return await orderList(ctx, a.tab as "new" | "confirmed" | "done");
      case "get_order":
        return await orderDetail(ctx, a.number as number);
      case "list_customers":
        return await customers(ctx);
      case "find_products":
        return await findProducts(ctx, a as { query?: string; restock_only?: boolean; hidden_only?: boolean });
      case "loading_sheet":
        return await loadingSheet(ctx, a.day as string);
      case "propose_confirm_orders":
        return await proposeConfirm(ctx, a.numbers as number[]);
      case "propose_reject_order":
        return await proposeReject(ctx, a.number as number, a.reason as string);
      case "propose_mark_delivered":
        return await proposeDeliver(ctx, a.numbers as number[]);
      case "propose_set_active":
        return await proposeActive(ctx, a.product_ids as string[], a.active as boolean);
      case "propose_set_price":
        return await proposePrice(ctx, a.product_id as string, a.price as number);
      case "show_choices":
        return { ok: true, forModel: { shown: true, note: "The choices are on screen as buttons. Wait for the supplier to pick one." }, view: { kind: "choices", question: a.question as string, options: a.options as string[] } };
    }
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "not_found" };
    console.error("supplier assistant tool failed:", name, error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

type OrderRow = { id: string; number: number; buyerName: string; status: OrderStatus; totalMinor: number; currency: string; deliveryDate: string | null; createdAt: Date };

async function snaps(rows: OrderRow[]): Promise<OrderSnap[]> {
  const fmt = await getFormats();
  const format = await getFormatter();
  const tr = await getTranslations("orderStatus");
  return rows.map((o) => ({
    id: o.id,
    number: `GST-${o.number}`,
    supplier: o.buyerName,
    status: o.status,
    statusLabel: tr(o.status),
    total: fmt.money(o.totalMinor, o.currency),
    deliveryDay: o.deliveryDate ? format.dateTime(new Date(`${o.deliveryDate}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : null,
    ordered: format.dateTime(o.createdAt, { dateStyle: "medium" }),
    href: `/supplier/orders/${o.id}`,
  }));
}

function orderFacts(items: OrderSnap[]) {
  return items.map((o) => ({ number: o.number, buyer: o.supplier, status: o.status, total: o.total, delivery_day: o.deliveryDay, ordered: o.ordered }));
}

async function pendingOrders(ctx: OrgCtx): Promise<ToolResult> {
  const queue = await listPendingQueue(ctx, MAX_ROWS);
  const items = await snaps(queue.map((q) => ({ ...q, status: "pending" as const, deliveryDate: null })));
  return { ok: true, forModel: { waiting: items.length, orders: orderFacts(items) }, view: { kind: "orders", items, allHref: "/supplier/orders" } };
}

async function orderList(ctx: OrgCtx, tab: "new" | "confirmed" | "done"): Promise<ToolResult> {
  const { items: rows } = await listSupplierOrders(ctx, tab, 1);
  const items = await snaps(rows.slice(0, MAX_ROWS));
  return { ok: true, forModel: { tab, orders: orderFacts(items) }, view: { kind: "orders", items, allHref: "/supplier/orders" } };
}

async function ownOrderId(ctx: OrgCtx, number: number): Promise<string | null> {
  const [row] = await getDb().select({ id: orders.id }).from(orders).where(and(eq(orders.number, number), eq(orders.supplierOrgId, ctx.orgId)));
  return row?.id ?? null;
}

async function orderDetail(ctx: OrgCtx, number: number): Promise<ToolResult> {
  const id = await ownOrderId(ctx, number);
  if (!id) return { ok: false, error: "not_found" };
  const detail = await getOrder(ctx, id);
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const [snap] = await snaps([detail.order]);
  const lines = detail.items.slice(0, 30).map((i) => ({
    name: i.name,
    qty: `${fmt.qty(i.confirmedQtyMilli ?? i.orderedQtyMilli)} ${tu(i.unit)}`,
    price: fmt.money(i.unitPriceMinor, detail.order.currency),
    total: fmt.money(i.lineTotalMinor, detail.order.currency),
  }));
  return {
    ok: true,
    forModel: { number: snap.number, buyer: snap.supplier, status: snap.status, total: snap.total, delivery_day: snap.deliveryDay, note: detail.order.note ?? null, lines },
    view: { kind: "order", order: snap, lines, reorderHref: null },
  };
}

async function customers(ctx: OrgCtx): Promise<ToolResult> {
  const t = await getTranslations("customers.status");
  const list = (await listCustomers(ctx)).slice(0, 40);
  return {
    ok: true,
    forModel: { customers: list.map((c) => ({ name: c.businessName, status: c.status, price_list: c.priceListName })) },
    view: {
      kind: "list",
      title: "",
      rows: list.map((c) => ({ primary: c.businessName, secondary: c.priceListName, tail: t(c.status), href: `/supplier/customers/${c.id}` })),
      allHref: "/supplier/customers",
      empty: null,
    },
  };
}

async function findProducts(ctx: OrgCtx, a: { query?: string; restock_only?: boolean; hidden_only?: boolean }): Promise<ToolResult> {
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const t = await getTranslations("supplierAssistant");
  const currency = await currencyOf(ctx);
  const { items, total } = await listSupplierProducts(ctx, { q: a.query, lowStock: a.restock_only, status: a.hidden_only ? "inactive" : "all" });
  const shown = items.slice(0, MAX_ROWS);
  const stock = (s: number | null, unit: string) => (s === null ? t("stockUntracked") : `${fmt.qty(s)} ${tu(unit as "piece")}`);
  return {
    ok: true,
    forModel: {
      total_matches: total,
      products: shown.map((p) => ({ uuid: p.id, name: p.name, sku: p.sku, price: fmt.money(p.basePriceMinor, currency), stock: stock(p.stockMilli, p.unit), visible: p.isActive })),
    },
    view: {
      kind: "list",
      title: a.query ?? "",
      rows: shown.map((p) => ({ primary: p.name, secondary: `${fmt.money(p.basePriceMinor, currency)} / ${tu(p.unit as "piece")}${p.isActive ? "" : ` · ${t("hidden")}`}`, tail: stock(p.stockMilli, p.unit), href: `/supplier/products/${p.id}` })),
      allHref: "/supplier/products",
      empty: null,
    },
  };
}

async function loadingSheet(ctx: OrgCtx, dayInput: string): Promise<ToolResult> {
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const clock = await getSupplierClock(ctx);
  const day = dayInput === "today" ? clock.today : dayInput === "tomorrow" ? addDays(clock.today, 1) : dayInput;
  const sheet = await getPickList(ctx, day);
  const rows = sheet.groups.flatMap((g) => g.rows);
  return {
    ok: true,
    forModel: { day: sheet.day, stops: sheet.orders.length, products: rows.map((r) => ({ name: r.name, qty: `${fmt.qty(r.qtyMilli)} ${tu(r.unit as "piece")}`, orders: r.orderCount })) },
    view: {
      kind: "list",
      title: sheet.day,
      rows: rows.slice(0, 40).map((r) => ({ primary: r.name, secondary: null, tail: `${fmt.qty(r.qtyMilli)} ${tu(r.unit as "piece")}`, href: null })),
      allHref: `/supplier/orders/pick?day=${sheet.day}`,
      empty: null,
    },
  };
}

// ---------- proposals ----------

async function ordersByNumber(ctx: OrgCtx, nums: number[], status: OrderStatus) {
  const unique = [...new Set(nums)];
  const found: (OrderRow & { itemCount: number })[] = [];
  const missing: number[] = [];
  for (const n of unique) {
    const id = await ownOrderId(ctx, n);
    if (!id) {
      missing.push(n);
      continue;
    }
    const d = await getOrder(ctx, id);
    if (d.order.status !== status) {
      missing.push(n);
      continue;
    }
    found.push({ ...d.order, itemCount: d.items.length });
  }
  return { found, missing };
}

async function currencyOf(ctx: OrgCtx): Promise<string> {
  const [org] = await getDb().select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return org?.currency ?? "GEL";
}

const cannot = (missing: number[], status: string) => ({ ok: false as const, error: `not_${status}:${missing.map((n) => `GST-${n}`).join(",")}` });

async function proposeConfirm(ctx: OrgCtx, nums: number[]): Promise<ToolResult> {
  const { found, missing } = await ordersByNumber(ctx, nums, "pending");
  if (found.length === 0) return cannot(missing, "pending");
  const fmt = await getFormats();
  const t = await getTranslations("supplierAssistant.proposal");
  return {
    ok: true,
    forModel: { proposal_shown: true, orders: found.map((o) => `GST-${o.number}`), skipped_not_pending: missing.map((n) => `GST-${n}`), note: "Nothing has changed yet. Tell the supplier to check the card and tap the button." },
    view: {
      kind: "proposal",
      title: t("confirmTitle", { count: found.length }),
      rows: found.map((o) => ({ label: `GST-${o.number} · ${o.buyerName}`, before: t("pending"), after: `${t("confirmed")} · ${fmt.money(o.totalMinor, o.currency)}` })),
      note: t("confirmNote"),
      danger: false,
      confirmLabel: t("confirmButton", { count: found.length }),
      action: { type: "orders_confirm", orderIds: found.map((o) => o.id) },
      href: "/supplier/orders",
    },
  };
}

async function proposeReject(ctx: OrgCtx, number: number, reason: string): Promise<ToolResult> {
  const { found, missing } = await ordersByNumber(ctx, [number], "pending");
  if (found.length === 0) return cannot(missing, "pending");
  const o = found[0];
  const fmt = await getFormats();
  const t = await getTranslations("supplierAssistant.proposal");
  return {
    ok: true,
    forModel: { proposal_shown: true, order: `GST-${o.number}`, reason, note: "Nothing has changed yet. Tell the supplier to check the card and tap the button. The buyer will see the reason." },
    view: {
      kind: "proposal",
      title: t("rejectTitle", { number: `GST-${o.number}` }),
      rows: [
        { label: `${o.buyerName} · ${fmt.money(o.totalMinor, o.currency)}`, before: t("pending"), after: t("rejected") },
        { label: t("reason"), before: null, after: reason },
      ],
      note: t("rejectNote"),
      danger: true,
      confirmLabel: t("rejectButton"),
      action: { type: "order_reject", orderId: o.id, reason },
      href: `/supplier/orders/${o.id}`,
    },
  };
}

async function proposeDeliver(ctx: OrgCtx, nums: number[]): Promise<ToolResult> {
  const { found, missing } = await ordersByNumber(ctx, nums, "confirmed");
  if (found.length === 0) return cannot(missing, "confirmed");
  const fmt = await getFormats();
  const t = await getTranslations("supplierAssistant.proposal");
  return {
    ok: true,
    forModel: { proposal_shown: true, orders: found.map((o) => `GST-${o.number}`), skipped_not_confirmed: missing.map((n) => `GST-${n}`), note: "Nothing has changed yet. Tell the supplier to check the card and tap the button." },
    view: {
      kind: "proposal",
      title: t("deliverTitle", { count: found.length }),
      rows: found.map((o) => ({ label: `GST-${o.number} · ${o.buyerName}`, before: t("confirmed"), after: `${t("delivered")} · ${fmt.money(o.totalMinor, o.currency)}` })),
      note: t("deliverNote"),
      danger: false,
      confirmLabel: t("deliverButton", { count: found.length }),
      action: { type: "orders_deliver", orderIds: found.map((o) => o.id) },
      href: "/supplier/orders",
    },
  };
}

async function proposeActive(ctx: OrgCtx, ids: string[], active: boolean): Promise<ToolResult> {
  const t = await getTranslations("supplierAssistant.proposal");
  const rows: { id: string; name: string; isActive: boolean }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const p = await getSupplierProduct(ctx, id);
      if (p.isActive !== active) rows.push({ id: p.id, name: p.name, isActive: p.isActive });
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  if (rows.length === 0) return { ok: false, error: "nothing_to_change" };
  return {
    ok: true,
    forModel: { proposal_shown: true, products: rows.map((r) => r.name), note: "Nothing has changed yet. Tell the supplier to check the card and tap the button." },
    view: {
      kind: "proposal",
      title: active ? t("showTitle", { count: rows.length }) : t("hideTitle", { count: rows.length }),
      rows: rows.map((r) => ({ label: r.name, before: r.isActive ? t("visible") : t("hiddenState"), after: active ? t("visible") : t("hiddenState") })),
      note: active ? t("showNote") : t("hideNote"),
      danger: false,
      confirmLabel: active ? t("showButton", { count: rows.length }) : t("hideButton", { count: rows.length }),
      action: { type: "products_active", productIds: rows.map((r) => r.id), active },
      href: "/supplier/products",
    },
  };
}

async function proposePrice(ctx: OrgCtx, productId: string, price: number): Promise<ToolResult> {
  const product = await getSupplierProduct(ctx, productId);
  const priceMinor = Math.round(price * 100);
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) return { ok: false, error: "invalid_arguments" };
  if (priceMinor === product.basePriceMinor) return { ok: false, error: "nothing_to_change" };
  const fmt = await getFormats();
  const t = await getTranslations("supplierAssistant.proposal");
  const currency = await currencyOf(ctx);
  return {
    ok: true,
    forModel: { proposal_shown: true, product: product.name, from: fmt.money(product.basePriceMinor, currency), to: fmt.money(priceMinor, currency), note: "Nothing has changed yet. Tell the supplier to check the card and tap the button." },
    view: {
      kind: "proposal",
      title: t("priceTitle"),
      rows: [{ label: product.name, before: fmt.money(product.basePriceMinor, currency), after: fmt.money(priceMinor, currency) }],
      note: t("priceNote"),
      danger: false,
      confirmLabel: t("priceButton"),
      action: { type: "product_price", productId: product.id, priceMinor },
      href: `/supplier/products/${product.id}`,
    },
  };
}
