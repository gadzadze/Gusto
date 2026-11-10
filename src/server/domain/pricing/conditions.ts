import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  MAX_BP,
  MIN_BP,
  adjustmentBp,
  applyBp,
  conditionsFor,
  isPaymentMethod,
  termsBp,
  type PaymentMethod,
  type PriceRule,
  type Terms,
} from "@/lib/pricing/conditions";
import { getDb, type Db, type Tx } from "@/server/db/client";
import { organizations, paymentTermRequests, priceListItems, priceRules, products, supplierCustomers } from "@/server/db/schema";
import { recordSubjectEvent } from "@/server/notifications/events";
import { deliverAfterResponse } from "@/server/notifications/process";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { assertCatalogWritable, isUuid } from "@/server/domain/catalog/products";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getPriceList } from "@/server/domain/pricing/price-lists";

// Price conditions (rules on a price list) and the payment terms a customer has agreed with a supplier.
// The supplier sets the rules; a buyer asks for a payment method and interval; the supplier sees what that
// changes and approves or declines; only approved terms change the price (CLAUDE.md, "Price conditions").

export type ConditionsError = "invalid_rule" | "product_not_on_list" | "suspended" | "request_not_pending" | "no_connection" | "not_offered" | "rate_limited";

/** What the supplier types: one row. The server checks every field. */
export type RuleInput = {
  kind: "method" | "interval" | "qty";
  method?: string | null;
  intervalDays?: number | null;
  minQtyMilli?: number | null;
  adjustBp: number;
};

function toRow(r: typeof priceRules.$inferSelect): PriceRule {
  return {
    productId: r.productId,
    kind: r.kind as PriceRule["kind"],
    method: (r.method as PaymentMethod | null) ?? null,
    intervalDays: r.intervalDays,
    minQtyMilli: r.minQtyMilli,
    adjustBp: r.adjustBp,
  };
}

/** Every rule of one of the supplier's lists (list-wide and per-product). */
export async function getListRules(ctx: OrgCtx, priceListId: string): Promise<PriceRule[]> {
  assertSupplier(ctx);
  await getPriceList(ctx, priceListId);
  const rows = await getDb()
    .select()
    .from(priceRules)
    .where(and(eq(priceRules.priceListId, priceListId), eq(priceRules.supplierOrgId, ctx.orgId)))
    .orderBy(asc(priceRules.createdAt));
  return rows.map(toRow);
}

/**
 * Replaces the rules of one scope: the whole list (productId null) or one product on it. Everything is
 * validated again here, and the old rows of that scope are swapped for the new ones in one transaction.
 */
export async function saveScopeRules(ctx: OrgCtx, priceListId: string, productId: string | null, input: RuleInput[]): Promise<void> {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  if (productId !== null) {
    if (!isUuid(productId)) throw new NotFoundError("product");
    const [onList] = await getDb()
      .select({ id: priceListItems.productId })
      .from(priceListItems)
      .where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.productId, productId), eq(priceListItems.supplierOrgId, ctx.orgId)));
    if (!onList) throw new StateError<ConditionsError>("product_not_on_list");
  }
  const seen = new Set<string>();
  const rows = input.map((r) => {
    if (!Number.isInteger(r.adjustBp) || r.adjustBp < MIN_BP || r.adjustBp > MAX_BP) throw new StateError<ConditionsError>("invalid_rule");
    let key: string;
    if (r.kind === "method") {
      if (!isPaymentMethod(r.method)) throw new StateError<ConditionsError>("invalid_rule");
      key = `m:${r.method}`;
      return { kind: "method", method: r.method, intervalDays: null, minQtyMilli: null, adjustBp: r.adjustBp, key };
    }
    if (r.kind === "interval") {
      const days = r.intervalDays;
      if (days === null || days === undefined || !Number.isInteger(days) || days < 0 || days > 365) throw new StateError<ConditionsError>("invalid_rule");
      key = `i:${days}`;
      return { kind: "interval", method: null, intervalDays: days, minQtyMilli: null, adjustBp: r.adjustBp, key };
    }
    if (r.kind === "qty") {
      const qty = r.minQtyMilli;
      if (qty === null || qty === undefined || !Number.isInteger(qty) || qty <= 0 || qty > 100_000_000) throw new StateError<ConditionsError>("invalid_rule");
      key = `q:${qty}`;
      return { kind: "qty", method: null, intervalDays: null, minQtyMilli: qty, adjustBp: r.adjustBp, key };
    }
    throw new StateError<ConditionsError>("invalid_rule");
  });
  for (const r of rows) {
    if (seen.has(r.key)) throw new StateError<ConditionsError>("invalid_rule"); // the same row twice
    seen.add(r.key);
  }
  await getDb().transaction(async (tx) => {
    await tx
      .delete(priceRules)
      .where(
        and(
          eq(priceRules.priceListId, priceListId),
          eq(priceRules.supplierOrgId, ctx.orgId),
          productId === null ? sql`${priceRules.productId} is null` : eq(priceRules.productId, productId),
        ),
      );
    if (rows.length > 0) {
      await tx.insert(priceRules).values(
        rows.map((r) => ({ kind: r.kind, method: r.method, intervalDays: r.intervalDays, minQtyMilli: r.minQtyMilli, adjustBp: r.adjustBp, supplierOrgId: ctx.orgId, priceListId, productId })),
      );
    }
  });
}

export type BuyerPricing = {
  priceListId: string | null;
  rules: PriceRule[];
  terms: Terms;
};

/** The rules of the list a buyer is on with a supplier, and the terms agreed so far. Empty when there is no list. */
export async function loadBuyerPricing(buyerOrgId: string, supplierOrgId: string, db: Db | Tx = getDb()): Promise<BuyerPricing> {
  const [connection] = await db
    .select({ priceListId: supplierCustomers.priceListId, method: supplierCustomers.termsMethod, intervalDays: supplierCustomers.termsIntervalDays })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.buyerOrgId, buyerOrgId), eq(supplierCustomers.supplierOrgId, supplierOrgId), eq(supplierCustomers.status, "active")));
  if (!connection?.priceListId) return { priceListId: null, rules: [], terms: { method: null, intervalDays: null } };
  const rows = await db.select().from(priceRules).where(eq(priceRules.priceListId, connection.priceListId));
  return {
    priceListId: connection.priceListId,
    rules: rows.map(toRow),
    terms: { method: isPaymentMethod(connection.method) ? connection.method : null, intervalDays: connection.intervalDays },
  };
}

/** The price a line gets: the list price changed by the agreed terms and the quantity tier. */
export function priceLine(pricing: BuyerPricing, productId: string, listPriceMinor: number, qtyMilli: number) {
  const adjustBp = adjustmentBp(pricing.rules, productId, qtyMilli, pricing.terms);
  return { listPriceMinor, adjustBp, unitPriceMinor: applyBp(listPriceMinor, adjustBp) };
}

// ---- Terms requests ----

export type TermsState = {
  current: Terms;
  pending: { id: string; method: PaymentMethod | null; intervalDays: number | null } | null;
  lastDeclined: boolean;
  /** What the supplier's list offers (list-wide rows): the buyer picks from these. */
  methods: { method: PaymentMethod; adjustBp: number }[];
  intervals: { days: number; adjustBp: number }[];
  tiers: { minQtyMilli: number; adjustBp: number }[];
};

export async function getTermsState(ctx: OrgCtx, supplierOrgId: string): Promise<TermsState> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const db = getDb();
  const pricing = await loadBuyerPricing(ctx.orgId, supplierOrgId, db);
  if (!pricing.priceListId) throw new NotFoundError("supplier");
  const [latest] = await db
    .select()
    .from(paymentTermRequests)
    .where(and(eq(paymentTermRequests.buyerOrgId, ctx.orgId), eq(paymentTermRequests.supplierOrgId, supplierOrgId)))
    .orderBy(sql`${paymentTermRequests.createdAt} desc`)
    .limit(1);
  const list = conditionsFor(pricing.rules, null);
  return {
    current: pricing.terms,
    pending: latest?.status === "pending" ? { id: latest.id, method: (latest.method as PaymentMethod | null) ?? null, intervalDays: latest.intervalDays } : null,
    lastDeclined: latest?.status === "declined",
    methods: [...list.methods].map(([method, adjustBp]) => ({ method, adjustBp })),
    intervals: [...list.intervals].map(([days, adjustBp]) => ({ days, adjustBp })).sort((a, b) => a.days - b.days),
    tiers: list.tiers,
  };
}

/**
 * The buyer asks to pay a certain way. Only methods and intervals the supplier's list offers can be asked
 * for, and a new request replaces the buyer's open one. Nothing changes until the supplier approves.
 */
export async function requestTerms(ctx: OrgCtx, supplierOrgId: string, wanted: { method: string | null; intervalDays: number | null }): Promise<void> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const db = getDb();
  const pricing = await loadBuyerPricing(ctx.orgId, supplierOrgId, db);
  if (!pricing.priceListId) throw new StateError<ConditionsError>("no_connection");
  const offered = conditionsFor(pricing.rules, null);
  const method = wanted.method === null ? null : isPaymentMethod(wanted.method) && offered.methods.has(wanted.method) ? wanted.method : "bad";
  const days = wanted.intervalDays === null ? null : offered.intervals.has(wanted.intervalDays) ? wanted.intervalDays : -1;
  if (method === "bad" || days === -1) throw new StateError<ConditionsError>("not_offered");
  await consumeRateLimit(RATE_LIMITS.termsRequest, ctx.orgId);
  await db.transaction(async (tx) => {
    const same = pricing.terms.method === method && pricing.terms.intervalDays === days;
    await tx
      .update(paymentTermRequests)
      .set({ status: "declined", decidedAt: new Date() })
      .where(and(eq(paymentTermRequests.buyerOrgId, ctx.orgId), eq(paymentTermRequests.supplierOrgId, supplierOrgId), eq(paymentTermRequests.status, "pending")));
    if (same) return false; // asking for what is already agreed just withdraws the open request
    const [created] = await tx
      .insert(paymentTermRequests)
      .values({ buyerOrgId: ctx.orgId, supplierOrgId, method, intervalDays: days })
      .returning({ id: paymentTermRequests.id });
    // The supplier hears about it (in the app, and by email when their preference is on).
    const [customer] = await tx
      .select({ id: supplierCustomers.id, name: organizations.name })
      .from(supplierCustomers)
      .innerJoin(organizations, eq(organizations.id, supplierCustomers.buyerOrgId))
      .where(and(eq(supplierCustomers.supplierOrgId, supplierOrgId), eq(supplierCustomers.buyerOrgId, ctx.orgId)));
    if (customer) {
      await recordSubjectEvent(tx, {
        event: "terms_requested",
        subjectId: created.id,
        recipientOrgId: supplierOrgId,
        counterpartyName: customer.name,
        link: `/supplier/customers/${customer.id}`,
        actor: { userId: ctx.userId },
      });
    }
    return true;
  });
  deliverAfterResponse();
}

export type TermsRequestView = {
  id: string;
  customerId: string;
  buyerOrgId: string;
  buyerName: string;
  method: PaymentMethod | null;
  intervalDays: number | null;
  currentMethod: PaymentMethod | null;
  currentIntervalDays: number | null;
  /** The change the request makes to every price, before quantity tiers (list-wide values). */
  fromBp: number;
  toBp: number;
  /** A few products from the customer's list: price now and after, list-wide quantity tier not applied. */
  samples: { name: string; unit: string; nowMinor: number; afterMinor: number }[];
  currency: string;
};

/** Open requests from this supplier's customers, with what each one would change. */
export async function listTermsRequests(ctx: OrgCtx, onlyBuyerOrgId?: string): Promise<TermsRequestView[]> {
  assertSupplier(ctx);
  const db = getDb();
  const requests = await db
    .select({
      id: paymentTermRequests.id,
      customerId: supplierCustomers.id,
      buyerOrgId: paymentTermRequests.buyerOrgId,
      method: paymentTermRequests.method,
      intervalDays: paymentTermRequests.intervalDays,
      buyerName: supplierCustomers.businessName,
      priceListId: supplierCustomers.priceListId,
      currentMethod: supplierCustomers.termsMethod,
      currentIntervalDays: supplierCustomers.termsIntervalDays,
    })
    .from(paymentTermRequests)
    .innerJoin(
      supplierCustomers,
      and(eq(supplierCustomers.supplierOrgId, paymentTermRequests.supplierOrgId), eq(supplierCustomers.buyerOrgId, paymentTermRequests.buyerOrgId)),
    )
    .where(
      and(
        eq(paymentTermRequests.supplierOrgId, ctx.orgId),
        eq(paymentTermRequests.status, "pending"),
        onlyBuyerOrgId ? eq(paymentTermRequests.buyerOrgId, onlyBuyerOrgId) : undefined,
      ),
    )
    .orderBy(asc(paymentTermRequests.createdAt));
  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const views: TermsRequestView[] = [];
  for (const r of requests) {
    if (!r.priceListId) continue;
    const rules = (await db.select().from(priceRules).where(eq(priceRules.priceListId, r.priceListId))).map(toRow);
    const list = conditionsFor(rules, null);
    const fromTerms: Terms = { method: isPaymentMethod(r.currentMethod) ? r.currentMethod : null, intervalDays: r.currentIntervalDays };
    const toTerms: Terms = { method: isPaymentMethod(r.method) ? r.method : null, intervalDays: r.intervalDays };
    const items = await db
      .select({ id: products.id, name: products.name, unit: products.unit, base: products.basePriceMinor, price: priceListItems.priceMinor })
      .from(priceListItems)
      .innerJoin(products, eq(products.id, priceListItems.productId))
      .where(and(eq(priceListItems.priceListId, r.priceListId), eq(products.isActive, true)))
      .orderBy(asc(products.name))
      .limit(4);
    views.push({
      id: r.id,
      customerId: r.customerId,
      buyerOrgId: r.buyerOrgId,
      buyerName: r.buyerName,
      method: toTerms.method,
      intervalDays: toTerms.intervalDays,
      currentMethod: fromTerms.method,
      currentIntervalDays: fromTerms.intervalDays,
      fromBp: termsBp(list, fromTerms),
      toBp: termsBp(list, toTerms),
      samples: items.map((i) => {
        const listPrice = i.price ?? i.base;
        const own = conditionsFor(rules, i.id);
        return {
          name: i.name,
          unit: i.unit,
          nowMinor: applyBp(listPrice, termsBp(own, fromTerms)),
          afterMinor: applyBp(listPrice, termsBp(own, toTerms)),
        };
      }),
      currency: org?.currency ?? "GEL",
    });
  }
  return views;
}

/** The supplier approves (the customer's terms change) or declines (nothing changes). */
export async function decideTermsRequest(ctx: OrgCtx, requestId: string, approve: boolean): Promise<void> {
  assertCatalogWritable(ctx);
  if (!isUuid(requestId)) throw new NotFoundError("request");
  await getDb().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(paymentTermRequests)
      .where(and(eq(paymentTermRequests.id, requestId), eq(paymentTermRequests.supplierOrgId, ctx.orgId)))
      .for("update");
    if (!request) throw new NotFoundError("request");
    if (request.status !== "pending") throw new StateError<ConditionsError>("request_not_pending");
    await tx
      .update(paymentTermRequests)
      .set({ status: approve ? "approved" : "declined", decidedAt: new Date(), decidedByUserId: ctx.userId })
      .where(eq(paymentTermRequests.id, requestId));
    if (approve) {
      await tx
        .update(supplierCustomers)
        .set({ termsMethod: request.method, termsIntervalDays: request.intervalDays })
        .where(and(eq(supplierCustomers.supplierOrgId, ctx.orgId), eq(supplierCustomers.buyerOrgId, request.buyerOrgId)));
    }
    // The buyer hears the answer.
    const [supplier] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId));
    await recordSubjectEvent(tx, {
      event: approve ? "terms_approved" : "terms_declined",
      subjectId: requestId,
      recipientOrgId: request.buyerOrgId,
      counterpartyName: supplier?.name ?? "",
      link: `/buyer/suppliers/${ctx.orgId}`,
      actor: { userId: ctx.userId },
    });
  });
  deliverAfterResponse();
}

/** Resets one customer to the standard price (the supplier can always take agreed terms back). */
export async function clearCustomerTerms(ctx: OrgCtx, buyerOrgId: string): Promise<void> {
  assertCatalogWritable(ctx);
  if (!isUuid(buyerOrgId)) throw new NotFoundError("customer");
  await getDb()
    .update(supplierCustomers)
    .set({ termsMethod: null, termsIntervalDays: null })
    .where(and(eq(supplierCustomers.supplierOrgId, ctx.orgId), eq(supplierCustomers.buyerOrgId, buyerOrgId)));
}
