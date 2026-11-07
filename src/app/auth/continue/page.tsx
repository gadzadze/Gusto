import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LocaleSwitch } from "@/components/locale-switch";
import { Logo } from "@/components/logo";
import { ContinueCard } from "./continue-card";
import { Skeleton } from "@/components/ui/skeleton";

// A one-time sign-in link: never indexed, never cached.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TYPES = new Set(["email", "magiclink", "signup"]);

export default function ContinuePage(props: PageProps<"/auth/continue">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>
      <LocaleSwitch className="mb-6" />
      <Suspense fallback={<Skeleton className="h-48 w-full max-w-sm" />}>
        <Continue {...props} />
      </Suspense>
    </main>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function Continue({ searchParams }: Pick<PageProps<"/auth/continue">, "searchParams">) {
  const params = await searchParams;
  const tokenHash = one(params.token_hash);
  const type = one(params.type);
  const valid = tokenHash !== "" && TYPES.has(type);
  return <ContinueCard valid={valid} tokenHash={tokenHash} type={type} />;
}
