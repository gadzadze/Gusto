import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { previewSupplierInvite } from "@/server/domain/buyer/supplier-invites";
import { JoinPage } from "../../join-page";

// A link a buyer sent: never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function InvitedSuppliersPage(props: PageProps<"/suppliers/invite/[token]">) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-10 h-96 w-full max-w-3xl" />}>
      <Invited {...props} />
    </Suspense>
  );
}

async function Invited({ params }: PageProps<"/suppliers/invite/[token]">) {
  const { token } = await params;
  // The same answer for every unusable token, existing or not.
  const preview = await previewSupplierInvite(token);
  return <JoinPage invite={preview ? { token, ...preview } : "unavailable"} />;
}
