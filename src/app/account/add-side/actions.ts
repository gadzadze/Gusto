"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { registrationFor } from "@/server/auth/allow-list";
import { ACTIVE_ORG_COOKIE } from "@/server/auth/active-org";
import { requireUser } from "@/server/auth/guards";
import { OnboardingError, createOrganizationForUser } from "@/server/domain/onboarding/create-organization";
import { notifyAdminsOrgPending } from "@/server/notifications/admin-alerts";
import type { OnboardingResult } from "@/app/onboarding/actions";

/**
 * A person who already has one side (buyer or supplier) adds the other. It starts active at
 * once when their first side is active and the legal ID is the same (that business was
 * already vetted); otherwise it waits for the admin like any new business.
 */
export async function submitAddSide(raw: unknown): Promise<OnboardingResult> {
  const user = await requireUser();
  const registration = await registrationFor(user.email);
  const preapprovedLegalId = registration?.legalId ?? null;
  const parsed = onboardingSchema.safeParse(
    preapprovedLegalId && raw && typeof raw === "object" ? { ...raw, legalId: preapprovedLegalId } : raw,
  );
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  // The admin may have registered this address for one kind only.
  const pinned = registration?.role ?? null;
  if (pinned && pinned !== "both" && pinned !== parsed.data.kind) return { ok: false, error: "wrong_role" };

  let destination: string;
  try {
    const { orgId, orgType, status } = await createOrganizationForUser(user.userId, parsed.data, {
      addSide: true,
      preapprovedLegalId,
      signInEmail: user.email,
    });
    if (status === "active") {
      // Start acting as the new side right away.
      (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      destination = `/${orgType}`;
    } else {
      // Waiting for review: carry on as the side they already have.
      destination = orgType === "buyer" ? "/supplier" : "/buyer";
      const name = parsed.data.businessName;
      after(() => notifyAdminsOrgPending(orgType, name).catch(() => undefined));
    }
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: error.code };
    console.error("[add-side] failed", { userId: user.userId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "unknown" };
  }
  redirect(destination);
}

/**
 * A person adds a further company of a kind they already run (another brand of the same group).
 * The registration on their sign-in address belongs to their first business, so it is ignored here:
 * the new company always waits for the admin to vet its own legal ID.
 */
export async function submitAddAnother(raw: unknown): Promise<OnboardingResult> {
  const user = await requireUser();
  const registration = await registrationFor(user.email);
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  const pinned = registration?.role ?? null;
  if (pinned && pinned !== "both" && pinned !== parsed.data.kind) return { ok: false, error: "wrong_role" };
  let kind: "buyer" | "supplier";
  try {
    const created = await createOrganizationForUser(user.userId, parsed.data, {
      addSide: true,
      additional: true,
      signInEmail: user.email,
    });
    kind = created.orgType;
    const name = parsed.data.businessName;
    after(() => notifyAdminsOrgPending(created.orgType, name).catch(() => undefined));
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: error.code };
    console.error("[add-another] failed", { userId: user.userId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "unknown" };
  }
  redirect(`/${kind}?added=1`);
}
