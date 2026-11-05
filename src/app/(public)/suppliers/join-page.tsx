import { Check, Handshake } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { RequestForm } from "./request-form";

/**
 * What a supplier sees at /suppliers, or at /suppliers/invite/<token> when a buyer sent
 * them there. `invite` is the buyer's invitation (names only), "unavailable" for an
 * unusable link (the same answer whatever is wrong with it), or undefined for the plain page.
 */
export type JoinInvite = { token: string; buyerName: string; supplierName: string } | "unavailable" | undefined;

export async function JoinPage({ invite }: { invite?: JoinInvite }) {
  const t = await getTranslations("supplierRequest");
  const points = [t("point1"), t("point2"), t("point3"), t("point4")];
  const valid = invite && invite !== "unavailable" ? invite : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/">
          <Logo />
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href="/start">{t("signIn")}</Link>
        </Button>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        {valid ? (
          <section className="mt-4 flex gap-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
            <Handshake aria-hidden className="mt-0.5 size-6 shrink-0 text-brand" />
            <div>
              <h2 className="font-semibold">{t("invitedTitle", { buyer: valid.buyerName })}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("invitedBody", { buyer: valid.buyerName })}</p>
            </div>
          </section>
        ) : null}
        {invite === "unavailable" ? (
          <p role="status" className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            {t("invitedUnavailable")}
          </p>
        ) : null}
        <section className="py-10 sm:py-14">
          <h1 className="max-w-xl text-3xl font-semibold leading-tight sm:text-4xl sm:leading-tight">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">{t("intro")}</p>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex gap-3 text-sm sm:text-base">
                <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                {point}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-border p-5 sm:p-8" aria-labelledby="request-heading">
          <h2 id="request-heading" className="text-xl font-semibold">{t("formTitle")}</h2>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("formIntro")}</p>
          <RequestForm inviteToken={valid?.token} defaultBusinessName={valid?.supplierName} />
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            {t.rich("privacyNote", {
              privacy: (chunks) => (
                <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>
      </main>
    </div>
  );
}
