import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccessState } from "@/server/auth/guards";
import { PasswordForm } from "./password-form";

export default async function PasswordPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <Logo />
      <Suspense fallback={<Skeleton className="mt-8 h-72 w-full" />}>
        <PasswordGate />
      </Suspense>
    </main>
  );
}

// Not behind requireUser(): that guard sends people without a password here.
async function PasswordGate() {
  const t = await getTranslations("password");
  const state = await getAccessState();
  if (!state.signedIn) redirect("/login?next=/account/password");
  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold">{state.passwordSet ? t("titleChange") : t("titleFirst")}</h1>
      <p className="mt-2 text-muted-foreground">{state.passwordSet ? t("introChange") : t("introFirst")}</p>
      <div className="mt-8">
        <PasswordForm first={!state.passwordSet} />
      </div>
    </>
  );
}
