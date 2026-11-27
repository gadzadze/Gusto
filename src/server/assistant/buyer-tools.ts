import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { toProductViews } from "@/components/buyer/product-view";
import type { OrderSnap, ToolResult } from "@/lib/assistant/snapshots";
import type { OrderStatus } from "@/server/db/schema";
import { listConnectedSuppliers, searchConnectedCatalogs } from "@/server/domain/buyer/catalog";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { getCart, cartQuantities, listCarts } from "@/server/domain/orders/cart";
import { getOrder, listBuyerOrders, listOpenBuyerOrders, orderLinkTarget } from "@/server/domain/orders/queries";
import { getFormats } from "@/server/i18n/formats";

// What the assistant can look up for a buyer. Every tool reads through the same domain function the matching page uses, scoped by the
// signed-in buyer's context, so the assistant knows exactly what the buyer could see by hand and nothing more. Inputs are validated,
// results are bounded, and nothing here changes anything.

export const BUYER_TOOLS = ["search_products", "list_suppliers", "list_orders", "get_order", "get_cart"] as const;
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
