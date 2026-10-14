import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ProductUnit } from "@/lib/catalog/units";
import { computeTotals, minimumOrderShortfall, type Totals } from "@/lib/orders/totals";
import { isOrderableQuantity } from "@/lib/quantity";
import { getDb } from "@/server/db/client";
import { cartItems, carts, organizations, products, supplierCustomers, supplierSettings } from "@/server/db/schema";
import { getConnectedSupplier, type ConnectedSupplier } from "@/server/domain/buyer/catalog";
import { isUuid } from "@/server/domain/catalog/products";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { effectivePriceSql } from "@/server/domain/pricing/resolve";

// Carts are persisted, one per (buyer, supplier), and never merged. Prices
// shown in a cart are advisory: submit re-resolves everything.

export type CartError = "product_unavailable" | "invalid_quantity";

function assertBuyer(ctx: OrgCtx) {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
}

export type CartLine = {
  productId: string;
  name: string;
  sku: string | null;
  unit: ProductUnit;
  packDescription: string | null;
  imagePath: string | null;
  qtyMilli: number;
  minQtyMilli: number;
  qtyStepMilli: number;
  unitPriceMinor: number;
  vatRateBp: number;
  lineTotalMinor: number;
  /** Product deactivated or quantity no longer valid since it was added. */
  problem: "unavailable" | "invalid_quantity" | null;
};

export type Cart = {
  supplier: ConnectedSupplier;
  lines: CartLine[];
  totals: Totals;
  shortfallMinor: number;
};

/** The buyer's cart with one supplier, priced for this buyer. Empty if none. */
export async function getCart(ctx: OrgCtx, supplierOrgId: string): Promise<Cart> {
  assertBuyer(ctx);
  const supplier = await getConnectedSupplier(ctx, supplierOrgId);
  const rows = await getDb()
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      packDescription: products.packDescription,
      imagePath: products.imagePath,
      isActive: products.isActive,
      qtyMilli: cartItems.qtyMilli,
      minQtyMilli: products.minQtyMilli,
      qtyStepMilli: products.qtyStepMilli,
      unitPriceMinor: effectivePriceSql(ctx.orgId),
      vatRateBp: products.vatRateBp,
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(and(eq(carts.buyerOrgId, ctx.orgId), eq(carts.supplierOrgId, supplierOrgId)))
    .orderBy(asc(cartItems.createdAt), asc(products.name));

  const lines = rows.map((r) => ({
    ...r,
    problem: !r.isActive
      ? ("unavailable" as const)
      : !isOrderableQuantity(r.qtyMilli, r.minQtyMilli, r.qtyStepMilli)
        ? ("invalid_quantity" as const)
        : null,
  }));
  // Lines with problems don't count toward totals: they can't be ordered as-is.
  const orderable = lines.filter((l) => l.problem === null);
  const totals = computeTotals(
    orderable.map((l) => ({ unitPriceMinor: l.unitPriceMinor, vatRateBp: l.vatRateBp, qtyMilli: l.qtyMilli })),
    supplier.pricesIncludeVat,
  );
  const lineTotals = new Map(orderable.map((l, i) => [l.productId, totals.lines[i].lineTotalMinor]));
  return {
    supplier,
    lines: lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      unit: l.unit,
      packDescription: l.packDescription,
      imagePath: l.imagePath,
      qtyMilli: l.qtyMilli,
      minQtyMilli: l.minQtyMilli,
      qtyStepMilli: l.qtyStepMilli,
      unitPriceMinor: l.unitPriceMinor,
      vatRateBp: l.vatRateBp,
      lineTotalMinor: lineTotals.get(l.productId) ?? 0,
      problem: l.problem,
    })),
    totals,
    shortfallMinor: minimumOrderShortfall(totals.goodsMinor, supplier.minOrderMinor),
  };
}

export type CartSummary = { supplierOrgId: string; supplierName: string; itemCount: number };

/** Every non-empty cart the buyer has, one per supplier (visible suppliers only). */
export async function listCarts(ctx: OrgCtx): Promise<CartSummary[]> {
  assertBuyer(ctx);
  return getDb()
    .select({
      supplierOrgId: carts.supplierOrgId,
      supplierName: organizations.name,
      itemCount: sql<number>`count(${cartItems.productId})::int`,
    })
    .from(carts)
    .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
    .innerJoin(organizations, eq(organizations.id, carts.supplierOrgId))
    .innerJoin(
      supplierCustomers,
      and(
        eq(supplierCustomers.supplierOrgId, carts.supplierOrgId),
        eq(supplierCustomers.buyerOrgId, carts.buyerOrgId),
        eq(supplierCustomers.status, "active"),
      ),
    )
    .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
    .where(and(eq(carts.buyerOrgId, ctx.orgId), eq(organizations.status, "active")))
    .groupBy(carts.supplierOrgId, organizations.name)
    .orderBy(asc(organizations.name));
}

/** Quantities currently in the buyer's cart with a supplier, for catalog steppers. */
export async function cartQuantities(ctx: OrgCtx, supplierOrgId: string): Promise<Map<string, number>> {
  assertBuyer(ctx);
  const rows = await getDb()
    .select({ productId: cartItems.productId, qtyMilli: cartItems.qtyMilli })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(and(eq(carts.buyerOrgId, ctx.orgId), eq(carts.supplierOrgId, supplierOrgId)));
  return new Map(rows.map((r) => [r.productId, r.qtyMilli]));
}

/**
 * Sets the quantity of one product in the cart (0 removes it). The product
 * must be an active product of a connected, approved supplier, and the
 * quantity must respect its minimum and step.
 */
export async function setCartQuantity(
  ctx: OrgCtx,
  supplierOrgId: string,
  productId: string,
  qtyMilli: number,
): Promise<void> {
  assertBuyer(ctx);
  await getConnectedSupplier(ctx, supplierOrgId);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const db = getDb();

  await db.transaction(async (tx) => {
    const [product] = await tx
      .select({ isActive: products.isActive, min: products.minQtyMilli, step: products.qtyStepMilli })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.supplierOrgId, supplierOrgId)));
    if (!product) throw new NotFoundError("product");

    const [cart] = await tx
      .insert(carts)
      .values({ buyerOrgId: ctx.orgId, supplierOrgId })
      .onConflictDoUpdate({ target: [carts.buyerOrgId, carts.supplierOrgId], set: { updatedAt: new Date() } })
      .returning({ id: carts.id });

    if (qtyMilli === 0) {
      await tx.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
      return;
    }
    if (!product.isActive) throw new StateError<CartError>("product_unavailable");
    if (!isOrderableQuantity(qtyMilli, product.min, product.step)) throw new StateError<CartError>("invalid_quantity");

    await tx
      .insert(cartItems)
      .values({ cartId: cart.id, productId, qtyMilli })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.productId], set: { qtyMilli, updatedAt: new Date() } });
  });
}

/**
 * Adds several products at once (reorder). Inactive or no-longer-orderable
 * products are skipped and reported by name; quantities replace what's in
 * the cart for those products.
 */
export async function putItemsInCart(
  ctx: OrgCtx,
  supplierOrgId: string,
  items: { productId: string; qtyMilli: number; name: string }[],
): Promise<{ added: number; skipped: string[] }> {
  assertBuyer(ctx);
  await getConnectedSupplier(ctx, supplierOrgId);
  const ids = items.map((i) => i.productId);
  return getDb().transaction(async (tx) => {
    const found = ids.length
      ? await tx
          .select({ id: products.id, isActive: products.isActive, min: products.minQtyMilli, step: products.qtyStepMilli })
          .from(products)
          .where(and(eq(products.supplierOrgId, supplierOrgId), inArray(products.id, ids)))
      : [];
    const byId = new Map(found.map((p) => [p.id, p]));
    const ok = items.filter((i) => {
      const p = byId.get(i.productId);
      return p?.isActive && isOrderableQuantity(i.qtyMilli, p.min, p.step);
    });
    const skipped = items.filter((i) => !ok.includes(i)).map((i) => i.name);
    if (ok.length === 0) return { added: 0, skipped };

    const [cart] = await tx
      .insert(carts)
      .values({ buyerOrgId: ctx.orgId, supplierOrgId })
      .onConflictDoUpdate({ target: [carts.buyerOrgId, carts.supplierOrgId], set: { updatedAt: new Date() } })
      .returning({ id: carts.id });
    await tx
      .insert(cartItems)
      .values(ok.map((i) => ({ cartId: cart.id, productId: i.productId, qtyMilli: i.qtyMilli })))
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: { qtyMilli: sql`excluded.qty_milli`, updatedAt: new Date() },
      });
    return { added: ok.length, skipped };
  });
}
