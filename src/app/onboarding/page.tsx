import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { homePathFor } from "@/server/auth/access";
import { registrationFor } from "@/server/auth/allow-list";
import { getAccessState } from "@/server/auth/guards";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const t = await getTranslations("onboarding");
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-8">
        <Suspense fallback={<FormSkeleton />}>
          <OnboardingGate />
        </Suspense>
      </div>
    </main>
  );
}

async function OnboardingGate() {
  const state = await getAccessState();
  if (!state.signedIn) redirect("/login?next=/onboarding");
  // One organization per person in the MVP: onboarding runs once.
  if (state.membership) redirect(homePathFor(state));
  const registration = await registrationFor(state.email);
  return (
    <OnboardingForm
      lockedKind={registration?.role ?? null}
      registered={{ businessName: registration?.businessName ?? null, legalId: registration?.legalId ?? null }}
    />
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}
