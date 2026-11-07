import { Suspense } from "react";
import { DemoAccounts } from "@/components/demo-accounts";
import { Skeleton } from "@/components/ui/skeleton";
import { contactEmail } from "@/lib/legal";
import { safeNextPath } from "@/lib/safe-next";
import { LoginShell } from "./login-shell";
import { LoginForm, type LoginError } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <LoginShell
      form={
        <Suspense fallback={<FormSkeleton />}>
          <LoginFormFromParams searchParams={searchParams} />
        </Suspense>
      }
      demo={<DemoAccounts />}
    />
  );
}

async function LoginFormFromParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error: LoginError = params.error === "auth" ? "auth" : params.error === "not_allowed" ? "not_allowed" : null;
  return <LoginForm next={next} error={error} contactEmail={contactEmail()} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
