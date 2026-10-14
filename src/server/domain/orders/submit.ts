import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { computeTotals, minimumOrderShortfall } from "@/lib/orders/totals";
import { isOrderableQuantity } from "@/lib/quantity";
import { getDb, type Tx } from "@/server/db/client";
import {
  addresses,
  cartItems,
  carts,
  orderItems,
  orders,
  orderStatusHistory,
  organizations,
  products,
  supplierCustomers,
  supplierSettings,
} from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError, isUniqueViolation } from "@/server/domain/errors";
import { effectivePriceSql } from "@/server/domain/pricing/resolve";
import { recordOrderEvent } from "@/server/notifications/events";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { afterOrderSubmitted } from "./hooks";

export type SubmitError =
  | "empty_cart"
  | "below_minimum"
  | "address_required"
  | "supplier_unavailable"
  | "buyer_suspended"
  | "rate_limited";

/** What the buyer reviewed on the checkout page. Anything else is a change. */
export const submitInputSchema = z.object({
  idempotencyKey: z.uuid(),
  expected: z
    .array(z.object({ productId: z.uuid(), qtyMilli: z.number().int().positive(), unitPriceMinor: z.number().int().nonnegative() }))
    .max(500),
  addressId: z.uuid().optional(),
  newAddress: z
    .object({
      city: z.string().trim().min(1, "required").max(80, "too_long"),
      addressLine: z.string().trim().min(1, "required").max(240, "too_long"),
      instructions: z.string().trim().max(500, "too_long").optional(),
    })
    .optional(),
  note: z.string().trim().max(1000, "too_long").optional(),
});
export type SubmitInput = z.infer<typeof submitInputSchema>;

export type CartChange = {
  productId: string;
  name: string;
  kind: "price_changed" | "unavailable" | "quantity_invalid" | "quantity_changed" | "removed" | "added";
  before?: number;
  after?: number;
};

export type SubmitResult =
  | { status: "created" | "existing"; orderId: string; number: number }
  | { status: "changed"; changes: CartChange[] };

async function findByKey(db: ReturnType<typeof getDb> | Tx, buyerOrgId: string, key: string) {
  const [row] = await db
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .where(and(eq(orders.buyerOrgId, buyerOrgId), eq(orders.idempotencyKey, key)));
  return row;
}

/**
 * Turns the buyer's cart with one supplier into an order, in one
 * transaction. Everything is re-checked against the database: connection,
 * supplier status, product availability, quantities, prices, minimum order.
 * If anything differs from what the buyer reviewed, nothing is created and
 * the differences are returned. A repeated idempotency key returns the
 * order it already created.
 */
export async function submitOrder(ctx: OrgCtx, supplierOrgId: string, input: SubmitInput): Promise<SubmitResult> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const db = getDb();

  const existing = await findByKey(db, ctx.orgId, input.idempotencyKey);
  if (existing) return { status: "existing", orderId: existing.id, number: existing.number };

  // A repeat of an order that already exists is free; a new attempt counts.
  await consumeRateLimit(RATE_LIMITS.orderSubmit, ctx.orgId);

  let result: SubmitResult;
  try {
    result = await db.transaction(async (tx) => {
      // 1. Lock the cart: concurrent submits and cart edits queue behind us.
      const [cart] = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.buyerOrgId, ctx.orgId), eq(carts.supplierOrgId, supplierOrgId)))
        .for("update");
      if (!cart) {
        const again = await findByKey(tx, ctx.orgId, input.idempotencyKey);
        if (again) return { status: "existing" as const, orderId: again.id, number: again.number };
        throw new StateError<SubmitError>("empty_cart");
      }

      // A suspended buyer organization can't order (checked against the database,
      // not the request's context, so a suspension takes effect immediately).
      const [buyerOrg] = await tx
        .select({ status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId));
      if (buyerOrg?.status === "suspended") throw new StateError<SubmitError>("buyer_suspended");

      // 2. The connection is active and the supplier approved, right now.
      const [supplier] = await tx
        .select({
          name: organizations.name,
          currency: organizations.currency,
          pricesIncludeVat: supplierSettings.pricesIncludeVat,
          minOrderMinor: supplierSettings.minOrderMinor,
        })
        .from(supplierCustomers)
        .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
        .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
        .where(
          and(
            eq(supplierCustomers.supplierOrgId, supplierOrgId),
            eq(supplierCustomers.buyerOrgId, ctx.orgId),
            eq(supplierCustomers.status, "active"),
            eq(organizations.status, "active"),
          ),
        );
      if (!supplier) throw new StateError<SubmitError>("supplier_unavailable");

      // 3. Current products and this buyer's current prices.
      const lines = await tx
        .select({
          productId: products.id,
          name: products.name,
          sku: products.sku,
          unit: products.unit,
          packDescription: products.packDescription,
          isActive: products.isActive,
          minQtyMilli: products.minQtyMilli,
          qtyStepMilli: products.qtyStepMilli,
          vatRateBp: products.vatRateBp,
          unitPriceMinor: effectivePriceSql(ctx.orgId),
          qtyMilli: cartItems.qtyMilli,
        })
        .from(cartItems)
        .innerJoin(products, eq(products.id, cartItems.productId))
        .where(and(eq(cartItems.cartId, cart.id), eq(products.supplierOrgId, supplierOrgId)))
        .orderBy(asc(cartItems.createdAt), asc(products.name));
      if (lines.length === 0) throw new StateError<SubmitError>("empty_cart");

      // 4–5. Compare with what the buyer reviewed; any difference aborts.
      const expected = new Map(input.expected.map((e) => [e.productId, e]));
      const changes: CartChange[] = [];
      for (const line of lines) {
        const seen = expected.get(line.productId);
        if (!line.isActive) changes.push({ productId: line.productId, name: line.name, kind: "unavailable" });
        else if (!isOrderableQuantity(line.qtyMilli, line.minQtyMilli, line.qtyStepMilli)) {
          changes.push({ productId: line.productId, name: line.name, kind: "quantity_invalid" });
        } else if (!seen) changes.push({ productId: line.productId, name: line.name, kind: "added" });
        else if (seen.unitPriceMinor !== line.unitPriceMinor) {
          changes.push({ productId: line.productId, name: line.name, kind: "price_changed", before: seen.unitPriceMinor, after: line.unitPriceMinor });
        } else if (seen.qtyMilli !== line.qtyMilli) {
          changes.push({ productId: line.productId, name: line.name, kind: "quantity_changed", before: seen.qtyMilli, after: line.qtyMilli });
        }
      }
      const inCart = new Set(lines.map((l) => l.productId));
      for (const e of input.expected) {
        if (!inCart.has(e.productId)) changes.push({ productId: e.productId, name: "", kind: "removed" });
      }
      if (changes.length > 0) return { status: "changed" as const, changes };

      const totals = computeTotals(lines, supplier.pricesIncludeVat);
      if (minimumOrderShortfall(totals.goodsMinor, supplier.minOrderMinor) > 0) {
        throw new StateError<SubmitError>("below_minimum");
      }

      // Delivery address: one of the buyer's own, or a new one saved now.
      let address: { id: string; city: string; addressLine: string; instructions: string | null };
      if (input.newAddress) {
        const [created] = await tx
          .insert(addresses)
          .values({
            organizationId: ctx.orgId,
            city: input.newAddress.city,
            addressLine: input.newAddress.addressLine,
            instructions: input.newAddress.instructions || null,
          })
          .returning({ id: addresses.id, city: addresses.city, addressLine: addresses.addressLine, instructions: addresses.instructions });
        address = created;
      } else if (input.addressId) {
        const [own] = await tx
          .select({ id: addresses.id, city: addresses.city, addressLine: addresses.addressLine, instructions: addresses.instructions })
          .from(addresses)
          .where(and(eq(addresses.id, input.addressId), eq(addresses.organizationId, ctx.orgId)));
        if (!own) throw new StateError<SubmitError>("address_required");
        address = own;
      } else {
        throw new StateError<SubmitError>("address_required");
      }

      const [buyer] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId));

      // 6. The order, immutable item snapshots, and the first history row.
      const [order] = await tx
        .insert(orders)
        .values({
          buyerOrgId: ctx.orgId,
          supplierOrgId,
          buyerName: buyer.name,
          supplierName: supplier.name,
          currency: supplier.currency,
          pricesIncludeVat: supplier.pricesIncludeVat,
          addressId: address.id,
          deliveryCity: address.city,
          deliveryAddress: address.addressLine,
          deliveryInstructions: address.instructions,
          note: input.note || null,
          subtotalMinor: totals.subtotalMinor,
          vatMinor: totals.vatMinor,
          totalMinor: totals.totalMinor,
          idempotencyKey: input.idempotencyKey,
          createdByUserId: ctx.userId,
        })
        .returning({ id: orders.id, number: orders.number });
      await tx.insert(orderItems).values(
        lines.map((l, i) => ({
          orderId: order.id,
          lineNo: i + 1,
          productId: l.productId,
          name: l.name,
          sku: l.sku,
          unit: l.unit,
          packDescription: l.packDescription,
          unitPriceMinor: l.unitPriceMinor,
          vatRateBp: l.vatRateBp,
          orderedQtyMilli: l.qtyMilli,
          lineTotalMinor: totals.lines[i].lineTotalMinor,
        })),
      );
      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: null,
        toStatus: "pending",
        actorUserId: ctx.userId,
        actorOrgId: ctx.orgId,
      });

      // The notifications commit (or roll back) with the order itself.
      await recordOrderEvent(tx, {
        orderId: order.id,
        event: "order_submitted",
        actor: { userId: ctx.userId, orgId: ctx.orgId },
      });

      // 7. The cart is done.
      await tx.delete(carts).where(eq(carts.id, cart.id));
      return { status: "created" as const, orderId: order.id, number: order.number };
    });
  } catch (error) {
    // Two submits with the same key raced: the loser returns the winner's order.
    if (isUniqueViolation(error, "orders_buyer_idempotency_key")) {
      const winner = await findByKey(db, ctx.orgId, input.idempotencyKey);
      if (winner) return { status: "existing", orderId: winner.id, number: winner.number };
    }
    throw error;
  }

  if (result.status === "created") await afterOrderSubmitted(result.orderId);
  return result;
}
