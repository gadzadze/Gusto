import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitch } from "@/components/locale-switch";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { homePathFor } from "@/server/auth/access";
import { registrationFor } from "@/server/auth/allow-list";
import { getAccessState } from "@/server/auth/guards";
import { organizationPrefill } from "@/server/domain/onboarding/create-organization";
import { OnboardingForm } from "@/app/onboarding/onboarding-form";
import { submitAddAnother, submitAddSide } from "./actions";

export default function AddSidePage({ searchParams }: PageProps<"/account/add-side">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <div className="flex items-center justify-between gap-3">
        <Logo />
        <LocaleSwitch />
      </div>
      <Suspense fallback={<Skeleton className="mt-8 h-96 w-full" />}>
        <AddSideGate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Not behind a role guard: a buyer still waiting for review may add the supplier side.
async function AddSideGate({ searchParams }: Pick<PageProps<"/account/add-side">, "searchParams">) {
  const t = await getTranslations("addSide");
  const state = await getAccessState();
  if (!state.signedIn) redirect("/login?next=/account/add-side");
  if (!state.passwordSet) redirect("/account/password");
  if (state.memberships.length === 0) redirect("/onboarding");
  const params = await searchParams;
  const another = params.another === "buyer" || params.another === "supplier" ? params.another : null;
  if (another && state.memberships.some((m) => m.orgType === another)) {
    // A further company of a kind they already run (another brand): its own details, nothing prefilled.
    const reg = await registrationFor(state.email);
    if (reg?.role && reg.role !== "both" && reg.role !== another) redirect(homePathFor(state));
    return (
      <>
        <h1 className="mt-8 text-2xl font-semibold">{t(`another.title.${another}`)}</h1>
        <p className="mt-2 text-muted-foreground">{t("another.intro")}</p>
        <div className="mt-8">
          <OnboardingForm lockedKind={another} offerBoth={false} submit={submitAddAnother} />
        </div>
      </>
    );
  }
  const has = new Set(state.memberships.map((m) => m.orgType));
  const missing = has.has("buyer") ? (has.has("supplier") ? null : "supplier") : "buyer";
  if (!missing) redirect(homePathFor(state));
  const registration = await registrationFor(state.email);
  // An address the admin pinned to the other kind can't add this one.
  if (registration?.role && registration.role !== "both" && registration.role !== missing) redirect(homePathFor(state));
  const own = state.memberships.find((m) => m.orgId === state.membership?.orgId) ?? state.memberships[0];
  const prefill = await organizationPrefill(own.orgId);
  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold">{t(`title.${missing}`)}</h1>
      <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      <div className="mt-8">
        <OnboardingForm
          lockedKind={missing}
          offerBoth={false}
          submit={submitAddSide}
          registered={{ businessName: registration?.businessName ?? null, legalId: registration?.legalId ?? null }}
          defaults={prefill ? { ...prefill, legalId: prefill.legalId ?? "" } : undefined}
        />
      </div>
    </>
  );
}
