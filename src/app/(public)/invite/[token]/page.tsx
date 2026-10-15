import { CircleAlert, Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { registrationFor } from "@/server/auth/allow-list";
import { getAccessState } from "@/server/auth/guards";
import { previewInvitation } from "@/server/domain/customers/invitations";
import { AcceptButton, NewBuyerForm } from "./invite-forms";

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-10">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Invite {...props} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: PageProps<"/invite/[token]">) {
  const t = await getTranslations("invite");
  const { token } = await params;
  // Same response for every unusable token, existing or not.
  const [preview, state] = await Promise.all([previewInvitation(token), getAccessState()]);

  if (preview.status === "unavailable") {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <CircleAlert aria-hidden className="size-6 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("unavailableTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("unavailableBody")}</p>
          <Button asChild variant="outline">
            <Link href="/">{t("home")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const header = (
    <div className="space-y-2">
      <div className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Store aria-hidden className="size-5" />
      </div>
      <h1 className="text-xl font-semibold">{t("heading", { supplier: preview.supplierName })}</h1>
      <p className="text-sm text-muted-foreground">{t("body", { supplier: preview.supplierName })}</p>
    </div>
  );

  if (!state.signedIn) {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          {header}
          <Button asChild className="w-full">
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{t("signIn")}</Link>
          </Button>
          <p className="text-center text-sm text-muted-foreground">{t("signInHint")}</p>
        </CardContent>
      </Card>
    );
  }

  if (state.membership?.orgType === "supplier") {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          {header}
          <p className="rounded-md bg-muted p-3 text-sm">{t("supplierAccount")}</p>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="outline">{(await getTranslations("nav"))("signOut")}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (state.membership?.orgType === "buyer") {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          {header}
          <AcceptButton token={token} label={t("acceptAs", { business: state.membership.orgName })} />
        </CardContent>
      </Card>
    );
  }

  const registration = await registrationFor(state.email);
  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {header}
        <NewBuyerForm
          token={token}
          lockedLegalId={registration?.legalId ?? null}
          prefill={{
            businessName: preview.businessName,
            contactName: preview.contactName ?? "",
            phone: preview.contactPhone ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
