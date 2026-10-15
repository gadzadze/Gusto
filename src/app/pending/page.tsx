import { Hourglass } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { homePathFor } from "@/server/auth/access";
import { getAccessState } from "@/server/auth/guards";

export default function PendingPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
      <Logo />
      <Suspense fallback={<Skeleton className="mt-8 h-56 w-full" />}>
        <Pending />
      </Suspense>
    </main>
  );
}

async function Pending() {
  const t = await getTranslations("pending");
  const state = await getAccessState();
  if (!state.signedIn) redirect("/login?next=/pending");
  const home = homePathFor(state);
  // Only buyers waiting for verification belong here; everyone else goes on.
  if (home !== "/pending") redirect(home);
  return (
    <Card className="mt-8">
      <CardContent className="space-y-4 pt-6">
        <div className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Hourglass aria-hidden className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body", { name: state.membership?.orgName ?? "" })}</p>
        <p className="text-sm text-muted-foreground">{t("next")}</p>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="outline">{(await getTranslations("nav"))("signOut")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
