import "server-only";
import { and, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { toProductViews } from "@/components/buyer/product-view";
import { dueProducts } from "@/lib/assistant/history";
import { isOrderableQuantity } from "@/lib/quantity";
import { reconcileUnit } from "@/lib/voice/order-parse";
import type { OrderSnap, ToolResult } from "@/lib/assistant/snapshots";
import { loadOrderHistory } from "@/server/assistant/history";
import { getDb } from "@/server/db/client";
import { organizations, products, supplierCustomers, type OrderStatus } from "@/server/db/schema";
import { availableToBuyerSql } from "@/server/domain/pricing/resolve";
import { listConnectedSuppliers, searchConnectedCatalogs } from "@/server/domain/buyer/catalog";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { getCart, cartQuantities, listCarts } from "@/server/domain/orders/cart";
import { getOrder, listBuyerOrders, listOpenBuyerOrders, orderLinkTarget } from "@/server/domain/orders/queries";
import { getFormats } from "@/server/i18n/formats";

// What the assistant can look up for a buyer. Every tool reads through the same domain function the matching page uses, scoped by the
// signed-in buyer's context, so the assistant knows exactly what the buyer could see by hand and nothing more. Inputs are validated,
// results are bounded, and nothing here changes anything.

export const BUYER_TOOLS = ["search_products", "list_suppliers", "list_orders", "get_order", "get_cart", "suggest_reorder", "propose_cart_change", "propose_reorder", "propose_regular_order", "show_choices"] as const;
export type BuyerTool = (typeof BUYER_TOOLS)[number];

const MAX_PRODUCTS_PER_SUPPLIER = 6;
const MAX_ORDERS = 8;
const MAX_LINES = 30;

const schemas = {
  search_products: z.object({ query: z.string().trim().min(1).max(100) }),
  list_suppliers: z.object({}),
  list_orders: z.object({ open_only: z.boolean().optional() }),
  get_order: z.object({ number: z.coerce.number().int().positive() }),
  get_cart: z.object({}),
  suggest_reorder: z.object({}),
  propose_cart_change: z.object({
    product_id: z.string().min(1).max(60),
    quantity: z.coerce.number().min(0).max(100_000),
    mode: z.enum(["add", "set", "remove"]).default("add"),
    spoken_unit: z.string().max(20).optional(),
  }),
  propose_reorder: z.object({ number: z.coerce.number().int().positive() }),
  propose_regular_order: z.object({ number: z.coerce.number().int().positive(), weekday: z.coerce.number().int().min(1).max(7), name: z.string().trim().max(80).optional() }),
  show_choices: z.object({ question: z.string().trim().min(1).max(200), options: z.array(z.string().trim().min(1).max(80)).min(2).max(5) }),
};

export async function runBuyerTool(ctx: OrgCtx, name: string, args: unknown): Promise<ToolResult> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  if (!(BUYER_TOOLS as readonly string[]).includes(name)) return { ok: false, error: "unknown_tool" };
  const tool = name as BuyerTool;
  const parsed = schemas[tool].safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: "invalid_arguments" };
  try {
    switch (tool) {
      case "search_products":
        return await searchProducts(ctx, (parsed.data as { query: string }).query);
      case "list_suppliers":
        return await suppliers(ctx);
      case "list_orders":
        return await orderList(ctx, Boolean((parsed.data as { open_only?: boolean }).open_only));
      case "get_order":
        return await orderDetail(ctx, (parsed.data as { number: number }).number);
      case "get_cart":
        return await cart(ctx);
      case "suggest_reorder":
        return await suggestReorder(ctx);
      case "propose_cart_change":
        return await proposeCartChange(ctx, parsed.data as { product_id: string; quantity: number; mode: "add" | "set" | "remove"; spoken_unit?: string });
      case "propose_reorder":
        return await proposeReorder(ctx, (parsed.data as { number: number }).number);
      case "propose_regular_order":
        return await proposeRegular(ctx, parsed.data as { number: number; weekday: number; name?: string });
      case "show_choices":
        return { ok: true, forModel: { shown: true, note: "The choices are on screen as buttons. Wait for the buyer to pick one." }, view: { kind: "choices", question: (parsed.data as { question: string }).question, options: (parsed.data as { options: string[] }).options } };
    }
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "not_found" };
    console.error("assistant tool failed:", name, error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

async function searchProducts(ctx: OrgCtx, query: string): Promise<ToolResult> {
  const groups = await searchConnectedCatalogs(ctx, query);
  const views = await Promise.all(
    groups.map(async (g) => ({
      group: g,
      items: await toProductViews(g.items.slice(0, MAX_PRODUCTS_PER_SUPPLIER), g.supplier, await cartQuantities(ctx, g.supplier.id)),
    })),
  );
  return {
    ok: true,
    forModel: {
      query,
      results: views.flatMap((v) =>
        v.items.map((p) => ({ uuid: p.id, product: p.name, supplier: v.group.supplier.name, price_per_unit: `${p.price} / ${p.unit}`, notes: p.hints, in_cart: p.cartQtyMilli > 0 })),
      ),
      more_matches: groups.some((g) => g.totalMatches > MAX_PRODUCTS_PER_SUPPLIER),
    },
    view: {
      kind: "products",
      title: query,
      groups: views.map((v) => ({
        supplier: v.group.supplier.name,
        more: v.group.totalMatches > v.items.length ? { href: `/buyer/suppliers/${v.group.supplier.id}?q=${encodeURIComponent(query)}`, count: v.group.totalMatches } : null,
        items: v.items,
      })),
    },
  };
}

async function suppliers(ctx: OrgCtx): Promise<ToolResult> {
  const fmt = await getFormats();
  const list = await listConnectedSuppliers(ctx);
  return {
    ok: true,
    forModel: {
      suppliers: list.map((s) => ({
        name: s.name,
        city: s.city,
        phone: s.phone,
        products: s.productCount,
        min_order: s.minOrderMinor > 0 ? fmt.money(s.minOrderMinor, s.currency) : null,
        prices_include_vat: s.pricesIncludeVat,
        delivery_area: s.deliveryArea,
        delivery_terms: s.deliveryTerms,
        order_cutoff: s.orderCutoffNote,
      })),
    },
    view: {
      kind: "suppliers",
      items: list.map((s) => ({
        id: s.id,
        name: s.name,
        city: s.city,
        minOrder: s.minOrderMinor > 0 ? fmt.money(s.minOrderMinor, s.currency) : null,
        delivery: s.deliveryArea,
        products: s.productCount,
        href: `/buyer/suppliers/${s.id}`,
      })),
    },
  };
}

async function snapFor(rows: { id: string; number: number; supplierName: string; status: OrderStatus; totalMinor: number; currency: string; deliveryDate: string | null; createdAt: Date }[]): Promise<OrderSnap[]> {
  const fmt = await getFormats();
  const format = await getFormatter();
  const tr = await getTranslations("orderStatus");
  return rows.map((o) => ({
    id: o.id,
    number: `GST-${o.number}`,
    supplier: o.supplierName,
    status: o.status,
    statusLabel: tr(o.status),
    total: fmt.money(o.totalMinor, o.currency),
    deliveryDay: o.deliveryDate ? format.dateTime(new Date(`${o.deliveryDate}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : null,
    ordered: format.dateTime(o.createdAt, { dateStyle: "medium" }),
    href: `/buyer/orders/${o.id}`,
  }));
}

async function orderList(ctx: OrgCtx, openOnly: boolean): Promise<ToolResult> {
  const rows = openOnly ? await listOpenBuyerOrders(ctx, MAX_ORDERS) : (await listBuyerOrders(ctx, 1, MAX_ORDERS)).items;
  const items = await snapFor(rows.slice(0, MAX_ORDERS));
  return {
    ok: true,
    forModel: { orders: items.map((o) => ({ number: o.number, supplier: o.supplier, status: o.status, total: o.total, delivery_day: o.deliveryDay, ordered: o.ordered })) },
    view: { kind: "orders", items, allHref: "/buyer/orders" },
  };
}

async function orderDetail(ctx: OrgCtx, number: number): Promise<ToolResult> {
  const target = await orderLinkTarget(ctx, number);
  if (!target) return { ok: false, error: "not_found" };
  const detail = await getOrder(ctx, target.split("/").pop() as string);
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const [snap] = await snapFor([{ ...detail.order, supplierName: detail.order.supplierName }]);
  const lines = detail.items.slice(0, MAX_LINES).map((i) => ({
    name: i.name,
    qty: `${fmt.qty(i.confirmedQtyMilli ?? i.orderedQtyMilli)} ${tu(i.unit)}`,
    price: fmt.money(i.unitPriceMinor, detail.order.currency),
    total: fmt.money(i.lineTotalMinor, detail.order.currency),
  }));
  return {
    ok: true,
    forModel: { number: snap.number, supplier: snap.supplier, status: snap.status, total: snap.total, delivery_day: snap.deliveryDay, note: detail.order.note ?? null, lines },
    view: { kind: "order", order: snap, lines, reorderHref: null },
  };
}

async function cart(ctx: OrgCtx): Promise<ToolResult> {
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const summaries = await listCarts(ctx);
  const carts = await Promise.all(summaries.map((s) => getCart(ctx, s.supplierOrgId)));
  const shaped = carts.map((c) => ({
    supplier: c.supplier.name,
    lines: c.lines.slice(0, MAX_LINES).map((l) => ({ name: l.name, qty: `${fmt.qty(l.qtyMilli)} ${tu(l.unit)}`, total: fmt.money(l.lineTotalMinor, c.supplier.currency) })),
    total: fmt.money(c.totals.totalMinor, c.supplier.currency),
    shortfall: c.shortfallMinor > 0 ? fmt.money(c.shortfallMinor, c.supplier.currency) : null,
    href: `/buyer/cart#${c.supplier.id}`,
  }));
  return {
    ok: true,
    forModel: { carts: shaped.map((c) => ({ supplier: c.supplier, lines: c.lines, total: c.total, below_minimum_order_by: c.shortfall })) },
    view: { kind: "cart", carts: shaped, checkoutHref: shaped.length > 0 ? "/buyer/cart" : null },
  };
}

const uuidRe = /^[0-9a-f-]{36}$/i;

/** One product this buyer may order right now, with its supplier and the cart quantity. Anything else is "not found". */
async function orderableProduct(ctx: OrgCtx, productId: string) {
  if (!uuidRe.test(productId)) return null;
  const [row] = await getDb()
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      min: products.minQtyMilli,
      step: products.qtyStepMilli,
      supplierId: products.supplierOrgId,
      supplierName: organizations.name,
      currency: organizations.currency,
    })
    .from(products)
    .innerJoin(organizations, eq(organizations.id, products.supplierOrgId))
    .innerJoin(supplierCustomers, and(eq(supplierCustomers.supplierOrgId, products.supplierOrgId), eq(supplierCustomers.buyerOrgId, ctx.orgId), eq(supplierCustomers.status, "active")))
    .where(and(eq(products.id, productId), eq(products.isActive, true), eq(organizations.status, "active"), availableToBuyerSql(ctx.orgId)));
  return row ?? null;
}

async function proposeCartChange(ctx: OrgCtx, a: { product_id: string; quantity: number; mode: "add" | "set" | "remove"; spoken_unit?: string }): Promise<ToolResult> {
  const product = await orderableProduct(ctx, a.product_id);
  if (!product) return { ok: false, error: "product_not_found_or_not_orderable_by_voice" };
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const t = await getTranslations("buyer.assistant.proposal");
  const inCart = (await cartQuantities(ctx, product.supplierId)).get(product.id) ?? 0;
  let target = 0;
  if (a.mode !== "remove") {
    const settled = reconcileUnit(a.quantity, a.spoken_unit ?? null, product.unit);
    if (settled.unitCheck === "mismatch") return { ok: false, error: `unit_mismatch: this product is sold in ${product.unit}` };
    if (settled.quantityMilli === null || settled.quantityMilli <= 0) return { ok: false, error: "bad_quantity" };
    target = a.mode === "add" ? inCart + settled.quantityMilli : settled.quantityMilli;
    if (!isOrderableQuantity(target, product.min, product.step)) {
      return { ok: false, error: `quantity_not_allowed: minimum ${fmt.qty(product.min)} ${product.unit}, in steps of ${fmt.qty(product.step)}` };
    }
  }
  const unit = tu(product.unit);
  const before = inCart > 0 ? `${fmt.qty(inCart)} ${unit}` : null;
  const after = target > 0 ? `${fmt.qty(target)} ${unit}` : null;
  return {
    ok: true,
    forModel: { proposal_shown: true, product: product.name, supplier: product.supplierName, in_cart_before: before, in_cart_after: after, note: "Nothing has changed yet. Tell the buyer to check the card and tap the button." },
    view: {
      kind: "proposal",
      title: target === 0 ? t("cartRemoveTitle") : t("cartTitle"),
      rows: [{ label: `${product.name} · ${product.supplierName}`, before, after }],
      note: null,
      danger: false,
      confirmLabel: target === 0 ? t("cartRemoveConfirm") : t("cartConfirm"),
      action: { type: "cart_set", supplierId: product.supplierId, productId: product.id, qtyMilli: target },
      href: "/buyer/cart",
    },
  };
}

async function orderForProposal(ctx: OrgCtx, number: number) {
  const target = await orderLinkTarget(ctx, number);
  if (!target) return null;
  const detail = await getOrder(ctx, target.split("/").pop() as string);
  return detail;
}

async function proposeReorder(ctx: OrgCtx, number: number): Promise<ToolResult> {
  const detail = await orderForProposal(ctx, number);
  if (!detail) return { ok: false, error: "not_found" };
  const fmt = await getFormats();
  const tu = await getTranslations("units");
  const t = await getTranslations("buyer.assistant.proposal");
  const rows = detail.items.slice(0, MAX_LINES).map((i) => ({ label: i.name, before: null, after: `${fmt.qty(i.orderedQtyMilli)} ${tu(i.unit)}` }));
  return {
    ok: true,
    forModel: { proposal_shown: true, order: `GST-${detail.order.number}`, supplier: detail.order.supplierName, lines: rows.length, note: "Nothing has changed yet. Tell the buyer to check the card and tap the button. Current prices apply; unavailable products are skipped." },
    view: {
      kind: "proposal",
      title: t("reorderTitle", { number: `GST-${detail.order.number}`, supplier: detail.order.supplierName }),
      rows,
      note: t("reorderNote"),
      danger: false,
      confirmLabel: t("reorderConfirm"),
      action: { type: "reorder", orderId: detail.order.id },
      href: `/buyer/orders/${detail.order.id}`,
    },
  };
}

async function proposeRegular(ctx: OrgCtx, a: { number: number; weekday: number; name?: string }): Promise<ToolResult> {
  const detail = await orderForProposal(ctx, a.number);
  if (!detail) return { ok: false, error: "not_found" };
  const tr = await getTranslations("regular");
  const t = await getTranslations("buyer.assistant.proposal");
  const name = (a.name && a.name.length > 0 ? a.name : `${detail.order.supplierName}`).slice(0, 80);
  const day = tr(`days.${a.weekday as 1}`);
  return {
    ok: true,
    forModel: { proposal_shown: true, regular_order: name, every: day, note: "Nothing has changed yet. Tell the buyer to check the card and tap the button. It is a reminder, not an order." },
    view: {
      kind: "proposal",
      title: t("regularTitle"),
      rows: [{ label: name, before: null, after: tr("every", { day }) }],
      note: t("regularNote"),
      danger: false,
      confirmLabel: t("regularConfirm"),
      action: { type: "regular_create", orderId: detail.order.id, weekday: a.weekday, name },
      href: "/buyer/regular",
    },
  };
}

async function suggestReorder(ctx: OrgCtx): Promise<ToolResult> {
  const history = await loadOrderHistory(ctx);
  const now = new Date();
  const suppliers = new Map((await listConnectedSuppliers(ctx)).map((s) => [s.id, s.name]));
  const t = await getTranslations("buyer.assistant");
  const due = [...history.entries()].flatMap(([supplierId, orders]) => dueProducts(orders, now).map((d) => ({ ...d, supplierId })));
  if (due.length === 0) return { ok: true, forModel: { suggestions: [], note: "Nothing looks due." }, view: null };
  const ids = due.map((d) => d.productId);
  const rows = await getDb().select({ id: products.id, name: products.name }).from(products).where(and(eq(products.isActive, true), availableToBuyerSql(ctx.orgId)));
  const names = new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.name]));
  const shown = due.filter((d) => names.has(d.productId) && suppliers.has(d.supplierId)).slice(0, 8);
  const items = shown.map((d) => ({ name: names.get(d.productId) as string, supplier: suppliers.get(d.supplierId) as string, hint: t("dueHint", { every: d.everyDays, since: d.daysSince }) }));
  return {
    ok: true,
    forModel: { suggestions: items.map((i) => ({ product: i.name, supplier: i.supplier, usual: i.hint })), note: "Mention at most three, then offer to add them." },
    view: items.length > 0 ? { kind: "suggestions", items } : null,
  };
}
