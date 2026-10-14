"use server";

import { redirect } from "next/navigation";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { requireUser } from "@/server/auth/guards";
import {
  OnboardingError,
  createOrganizationForUser,
} from "@/server/domain/onboarding/create-organization";

export type OnboardingResult = {
  ok: false;
  error: "invalid" | "already_onboarded" | "unknown";
  fieldErrors?: Record<string, ValidationKey>;
};

export async function submitOnboarding(raw: unknown): Promise<OnboardingResult> {
  const user = await requireUser();

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  let destination: string;
  try {
    const { orgType } = await createOrganizationForUser(user.userId, parsed.data);
    destination = orgType === "buyer" ? "/buyer" : "/supplier";
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
