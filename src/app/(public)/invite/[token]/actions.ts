"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { buyerOnboardingSchema } from "@/lib/validation/onboarding";
import { registrationFor } from "@/server/auth/allow-list";
import { requireOrg, requireUser } from "@/server/auth/guards";
import { acceptInvitationAsBuyer, acceptInvitationWithNewBuyer, type InvitationError } from "@/server/domain/customers/invitations";
import { StateError } from "@/server/domain/errors";
import { OnboardingError } from "@/server/domain/onboarding/create-organization";
import { notifyAdminsOrgPending } from "@/server/notifications/admin-alerts";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type AcceptResult = {
  ok: false;
  error: InvitationError | "already_onboarded" | "legal_id_taken" | "invalid" | "rate_limited" | "wrong_role" | "unknown";
  fieldErrors?: Record<string, ValidationKey>;
};

function toResult(error: unknown): AcceptResult {
  if (error instanceof StateError) return { ok: false, error: error.code as InvitationError };
  if (error instanceof OnboardingError) return { ok: false, error: error.code };
  console.error("[invite] accept failed", { message: error instanceof Error ? error.message : String(error) });
  return { ok: false, error: "unknown" };
}

/**
 * 10 acceptance attempts per minute per client IP (hashed before it is
 * stored). Returns the error result to hand back, or null to go on.
 */
async function limitByIp(): Promise<AcceptResult | null> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    await consumeRateLimit(RATE_LIMITS.inviteAccept, ip, { hash: true });
    return null;
  } catch (error) {
    if (error instanceof StateError && error.code === "rate_limited") return { ok: false, error: "rate_limited" };
    throw error;
  }
}

/** A signed-in buyer organization accepts. */
export async function acceptInviteAction(token: string): Promise<AcceptResult> {
  const ctx = await requireOrg();
  const limited = await limitByIp();
  if (limited) return limited;
  let supplierOrgId: string;
  try {
    ({ supplierOrgId } = await acceptInvitationAsBuyer(ctx, String(token)));
  } catch (error) {
    return toResult(error);
  }
  redirect(`/buyer/suppliers/${supplierOrgId}`);
}

/** A signed-in person without an organization creates their buyer org and accepts. */
export async function acceptInviteWithOnboardingAction(token: string, raw: unknown): Promise<AcceptResult> {
  const user = await requireUser();
  const limited = await limitByIp();
  if (limited) return limited;
  // An address the admin registered as a supplier doesn't become a buyer.
  const registration = await registrationFor(user.email);
  if (registration?.role === "supplier") return { ok: false, error: "wrong_role" };
  // A buyer the admin vetted keeps that verified ID and starts active; anyone
  // else arrives from a WhatsApp link unvetted and waits for the admin's call.
  const preapprovedLegalId = registration?.legalId ?? null;
  const parsed = buyerOnboardingSchema.safeParse({
    ...(raw as object),
    ...(preapprovedLegalId ? { legalId: preapprovedLegalId } : {}),
    kind: "buyer",
  });
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  let supplierOrgId: string;
  try {
    ({ supplierOrgId } = await acceptInvitationWithNewBuyer(user.userId, String(token), parsed.data, {
      preapprovedLegalId,
    }));
    if (!preapprovedLegalId) {
      const name = parsed.data.businessName;
      after(() => notifyAdminsOrgPending("buyer", name).catch(() => undefined));
    }
  } catch (error) {
    return toResult(error);
  }
  redirect(`/buyer/suppliers/${supplierOrgId}`);
}
