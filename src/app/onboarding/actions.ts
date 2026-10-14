"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { pinnedRoleFor } from "@/server/auth/allow-list";
import { requireUser } from "@/server/auth/guards";
import { notifyAdminsSupplierPending } from "@/server/notifications/admin-alerts";
import {
  OnboardingError,
  createOrganizationForUser,
} from "@/server/domain/onboarding/create-organization";

export type OnboardingResult = {
  ok: false;
  error: "invalid" | "already_onboarded" | "wrong_role" | "unknown";
  fieldErrors?: Record<string, ValidationKey>;
};

export async function submitOnboarding(raw: unknown): Promise<OnboardingResult> {
  const user = await requireUser();

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // The admin may have registered this address for one kind only.
  const pinned = await pinnedRoleFor(user.email);
  if (pinned && pinned !== parsed.data.kind) return { ok: false, error: "wrong_role" };

  let destination: string;
  try {
    const { orgType } = await createOrganizationForUser(user.userId, parsed.data);
    destination = orgType === "buyer" ? "/buyer" : "/supplier";
    if (orgType === "supplier") {
      // A new supplier waits for approval: tell the admins, after the response.
      const name = parsed.data.businessName;
      after(() => notifyAdminsSupplierPending(name).catch(() => undefined));
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
