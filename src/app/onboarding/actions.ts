"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { registrationFor } from "@/server/auth/allow-list";
import { requireUser } from "@/server/auth/guards";
import { notifyAdminsOrgPending } from "@/server/notifications/admin-alerts";
import {
  OnboardingError,
  createOrganizationForUser,
} from "@/server/domain/onboarding/create-organization";

export type OnboardingResult = {
  ok: false;
  error: "invalid" | "already_onboarded" | "wrong_role" | "legal_id_taken" | "unknown";
  fieldErrors?: Record<string, ValidationKey>;
};

export async function submitOnboarding(raw: unknown): Promise<OnboardingResult> {
  const user = await requireUser();

  // The admin may have registered this address with a verified legal ID: that
  // ID is authoritative (not whatever was typed) and the business starts active.
  const registration = await registrationFor(user.email);
  const preapprovedLegalId = registration?.legalId ?? null;
  const parsed = onboardingSchema.safeParse(
    preapprovedLegalId && raw && typeof raw === "object" ? { ...raw, legalId: preapprovedLegalId } : raw,
  );
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // The admin may have registered this address for one kind only.
  const pinned = registration?.role ?? null;
  if (pinned && pinned !== parsed.data.kind) return { ok: false, error: "wrong_role" };

  let destination: string;
  try {
    const { orgType, status } = await createOrganizationForUser(user.userId, parsed.data, {
      // Only a registration for this kind counts as vetted.
      preapprovedLegalId: pinned === null || pinned === parsed.data.kind ? preapprovedLegalId : null,
    });
    destination = orgType === "buyer" ? "/buyer" : "/supplier";
    if (status === "pending_review") {
      // Someone the admin has not vetted yet: tell the admins, after the response.
      const name = parsed.data.businessName;
      after(() => notifyAdminsOrgPending(orgType, name).catch(() => undefined));
    }
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: error.code };
    // Message only: driver errors can carry submitted values in `detail`.
    console.error("[onboarding] failed", {
      userId: user.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "unknown" };
  }
  redirect(destination);
}
