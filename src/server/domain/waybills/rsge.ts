import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buildWaybillXml, WaybillBuildError, type WaybillOrder, type WaybillTransport } from "@/lib/rsge-waybill";
import { getDb } from "@/server/db/client";
import { orderWaybills, organizations, rsConnections, type OrderWaybill } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getWaybillSheet } from "@/server/domain/orders/waybill";
import { assertOwner } from "@/server/domain/team/team";
import { createRsApi, RsError, type RsApi, type RsCredentials } from "@/server/rsge/client";
import { openSecret, sealSecret, secretsConfigured } from "@/server/rsge/crypto";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

// RS.ge e-waybills, phase 2: send a confirmed order's waybill to RS.ge from 202.
//
// Safety rules, all enforced here:
//  - off unless RSGE_ENABLED=1 and an encryption key is configured;
//  - only a company's owner connects its RS.ge service user, and the credentials must belong to THAT company
//    (RS.ge's tax id for the service user must equal the company's legal id);
//  - sending is two deliberate steps: "save draft" (nothing is in force yet) then "activate";
//  - one waybill per order (unique), a double click cannot send twice (row lock);
//  - anything unclear from RS.ge is treated as a refusal, never as success.

export type RsgeError =
  | "disabled"
  | "not_owner"
  | "not_connected"
  | "invalid_credentials"
  | "wrong_company"
  | "rs_unreachable"
  | "rs_rejected"
  | "already_exists"
  | "not_draft"
  | "not_active"
  | "invalid_transport"
  | "rate_limited"
  | WaybillBuildError["code"];

export function rsgeEnabled(): boolean {
  return process.env.RSGE_ENABLED === "1" && secretsConfigured();
}

function assertEnabled(): void {
  if (!rsgeEnabled()) throw new StateError<RsgeError>("disabled");
}

const transportSchema = z.object({
  startAddress: z.string().trim().min(3).max(300),
  driverName: z.string().trim().max(120),
  driverId: z.string().trim().regex(/^(\d{11})?$/),
  vehicle: z.string().trim().min(3).max(20),
});

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RsError) throw new StateError<RsgeError>(error.code === "unreachable" ? "rs_unreachable" : "rs_rejected");
    if (error instanceof WaybillBuildError) throw new StateError<RsgeError>(error.code);
    throw error;
  }
}

async function loadCredentials(orgId: string): Promise<RsCredentials> {
  const [row] = await getDb().select().from(rsConnections).where(eq(rsConnections.organizationId, orgId));
  if (!row) throw new StateError<RsgeError>("not_connected");
  return { su: openSecret(row.suCipher), sp: openSecret(row.spCipher) };
}

export type RsStatus = { enabled: boolean; connected: boolean; verifiedAt: Date | null };

export async function getRsStatus(ctx: OrgCtx): Promise<RsStatus> {
  assertSupplier(ctx);
  if (!rsgeEnabled()) return { enabled: false, connected: false, verifiedAt: null };
  const [row] = await getDb().select({ verifiedAt: rsConnections.verifiedAt }).from(rsConnections).where(eq(rsConnections.organizationId, ctx.orgId));
  return { enabled: true, connected: !!row, verifiedAt: row?.verifiedAt ?? null };
}

/** The owner connects the company's RS.ge service user. It is checked with RS.ge and must belong to this company. */
export async function connectRs(ctx: OrgCtx, rawSu: string, rawSp: string, api: RsApi = createRsApi()): Promise<void> {
  assertSupplier(ctx);
  assertEnabled();
  const su = rawSu.trim();
  if (su.length < 2 || su.length > 100 || rawSp.length < 1 || rawSp.length > 200) throw new StateError<RsgeError>("invalid_credentials");
  await assertOwner(getDb(), ctx).catch((error) => {
    if (error instanceof StateError) throw new StateError<RsgeError>("not_owner");
    throw error;
  });
  await consumeRateLimit(RATE_LIMITS.rsgeConnect, ctx.orgId);
  const creds = { su, sp: rawSp };
  const checked = await guarded(() => api.checkServiceUser(creds));
  if (!checked) throw new StateError<RsgeError>("invalid_credentials");
  // The service user must belong to this company: RS.ge's tax id for it equals the legal id we vetted.
  const [org] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const tin = await guarded(() => api.tinFromUnId(creds, checked.payerId));
  if (!tin || !org?.legalId || tin !== org.legalId) throw new StateError<RsgeError>("wrong_company");
  await getDb().transaction(async (tx) => {
    const values = {
      suCipher: sealSecret(su),
      spCipher: sealSecret(rawSp),
      payerId: checked.payerId,
      serviceUserId: checked.serviceUserId,
      verifiedAt: new Date(),
      connectedByUserId: ctx.userId,
    };
    await tx.insert(rsConnections).values({ organizationId: ctx.orgId, ...values }).onConflictDoUpdate({ target: rsConnections.organizationId, set: values });
    await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.connected", targetType: "organization", targetId: ctx.orgId });
  });
}

export async function disconnectRs(ctx: OrgCtx): Promise<void> {
  assertSupplier(ctx);
  await assertOwner(getDb(), ctx).catch((error) => {
    if (error instanceof StateError) throw new StateError<RsgeError>("not_owner");
    throw error;
  });
  await getDb().transaction(async (tx) => {
    await tx.delete(rsConnections).where(eq(rsConnections.organizationId, ctx.orgId));
    await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.disconnected", targetType: "organization", targetId: ctx.orgId });
  });
}

export async function getOrderWaybill(ctx: OrgCtx, orderId: string): Promise<OrderWaybill | null> {
  assertSupplier(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new NotFoundError("order");
  const [row] = await getDb().select().from(orderWaybills).where(and(eq(orderWaybills.orderId, orderId), eq(orderWaybills.organizationId, ctx.orgId)));
  return row ?? null;
}

/** Step 1: save the waybill in RS.ge as a draft. Nothing is in force yet. */
export async function saveWaybillDraft(ctx: OrgCtx, orderId: string, rawTransport: unknown, api: RsApi = createRsApi()): Promise<{ rsWaybillId: number }> {
  assertSupplier(ctx);
  assertEnabled();
  const parsed = transportSchema.safeParse(rawTransport);
  if (!parsed.success) throw new StateError<RsgeError>("invalid_transport");
  const transport: WaybillTransport = parsed.data;
  const creds = await loadCredentials(ctx.orgId);
  await consumeRateLimit(RATE_LIMITS.rsgeCall, ctx.orgId);
  const sheet = await getWaybillSheet(ctx, orderId); // seller only, confirmed or delivered, else not found
  if (await getOrderWaybill(ctx, orderId)) throw new StateError<RsgeError>("already_exists");
  const input: WaybillOrder = {
    buyerName: sheet.buyer.name,
    buyerLegalId: sheet.buyer.legalId ?? "",
    sellerLegalId: sheet.seller.legalId ?? "",
    deliveryAddress: sheet.deliveryAddress,
    deliveryCity: sheet.deliveryCity,
    date: sheet.deliveryDate ?? new Date().toISOString().slice(0, 10),
    pricesIncludeVat: sheet.pricesIncludeVat,
    lines: sheet.lines.map((l) => ({
      name: l.name,
      code: l.code,
      unit: l.unit,
      qtyMilli: l.qtyMilli,
      lineTotalMinor: l.lineTotalMinor,
      lineVatMinor: l.lineVatMinor,
      vatRateBp: l.vatRateBp,
    })),
  };
  if (!input.buyerLegalId) throw new StateError<RsgeError>("invalid_credentials");
  const rsWaybillId = await guarded(async () => {
    const units = await api.units(creds);
    const xml = buildWaybillXml(input, transport, units);
    return api.saveWaybill(creds, xml);
  });
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(orderWaybills).values({
        orderId,
        organizationId: ctx.orgId,
        status: "draft",
        rsWaybillId,
        startAddress: transport.startAddress,
        driverName: transport.driverName || null,
        driverId: transport.driverId || null,
        vehicle: transport.vehicle,
        createdByUserId: ctx.userId,
      });
      await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.draft_saved", targetType: "order", targetId: orderId, data: { rsWaybillId } });
    });
  } catch (error) {
    // The draft exists at RS.ge but we could not record it: remove it so nothing is left half-done.
    await api.deleteWaybill(creds, rsWaybillId).catch(() => undefined);
    throw error;
  }
  return { rsWaybillId };
}

type Step = "draft" | "active";

/** Runs one RS.ge call on this order's waybill while holding its row, so a double click cannot repeat it. */
async function withWaybillRow<T>(ctx: OrgCtx, orderId: string, expect: Step, run: (row: OrderWaybill, creds: RsCredentials) => Promise<T>, after: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], row: OrderWaybill, result: T) => Promise<void>): Promise<T> {
  assertSupplier(ctx);
  assertEnabled();
  const creds = await loadCredentials(ctx.orgId);
  await consumeRateLimit(RATE_LIMITS.rsgeCall, ctx.orgId);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(orderWaybills)
      .where(and(eq(orderWaybills.orderId, orderId), eq(orderWaybills.organizationId, ctx.orgId)))
      .for("update");
    if (!row) throw new NotFoundError("waybill");
    if (row.status !== expect) throw new StateError<RsgeError>(expect === "draft" ? "not_draft" : "not_active");
    if (row.rsWaybillId === null) throw new StateError<RsgeError>("not_draft");
    const result = await guarded(() => run(row, creds));
    await after(tx, row, result);
    return result;
  });
}

/** Step 2: activate the saved draft (it is now a waybill in force). Returns RS.ge's waybill number. */
export async function activateWaybill(ctx: OrgCtx, orderId: string, api: RsApi = createRsApi()): Promise<string> {
  return withWaybillRow(
    ctx,
    orderId,
    "draft",
    (row, creds) => api.sendWaybill(creds, row.rsWaybillId as number),
    async (tx, row, number) => {
      await tx.update(orderWaybills).set({ status: "active", rsNumber: number, activatedAt: new Date(), lastError: null }).where(eq(orderWaybills.id, row.id));
      await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.activated", targetType: "order", targetId: orderId, data: { rsNumber: number } });
    },
  );
}

/** Closes an active waybill (the goods arrived). */
export async function closeWaybill(ctx: OrgCtx, orderId: string, api: RsApi = createRsApi()): Promise<void> {
  await withWaybillRow(
    ctx,
    orderId,
    "active",
    (row, creds) => api.closeWaybill(creds, row.rsWaybillId as number),
    async (tx, row) => {
      await tx.update(orderWaybills).set({ status: "closed", closedAt: new Date() }).where(eq(orderWaybills.id, row.id));
      await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.closed", targetType: "order", targetId: orderId });
    },
  );
}

/** Throws a draft away (RS.ge deletes it and 202 forgets it), so the order can get a new one. */
export async function discardDraft(ctx: OrgCtx, orderId: string, api: RsApi = createRsApi()): Promise<void> {
  await withWaybillRow(
    ctx,
    orderId,
    "draft",
    (row, creds) => api.deleteWaybill(creds, row.rsWaybillId as number),
    async (tx, row) => {
      await tx.delete(orderWaybills).where(eq(orderWaybills.id, row.id));
      await writeAudit(tx, { actorUserId: ctx.userId, action: "rsge.draft_discarded", targetType: "order", targetId: orderId });
    },
  );
}

/** The waybill as RS.ge stored it, so it can be checked before activating. */
export async function readWaybillAtRs(ctx: OrgCtx, orderId: string, api: RsApi = createRsApi()): Promise<string> {
  assertSupplier(ctx);
  assertEnabled();
  const row = await getOrderWaybill(ctx, orderId);
  if (!row || row.rsWaybillId === null) throw new NotFoundError("waybill");
  const creds = await loadCredentials(ctx.orgId);
  await consumeRateLimit(RATE_LIMITS.rsgeCall, ctx.orgId);
  return guarded(() => api.getWaybill(creds, row.rsWaybillId as number));
}
