import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccessState } from "@/server/auth/guards";
import { orderLinkTarget } from "@/server/domain/orders/queries";

// Shareable order link (/o/1042): sends each side to its own order page.
// Anyone else — including another org that guesses the number — gets 404.
export default function OrderLinkPage(props: PageProps<"/o/[number]">) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-40" />}>
      <Resolve {...props} />
    </Suspense>
  );
}

async function Resolve({ params }: PageProps<"/o/[number]">): Promise<null> {
  const { number } = await params;
  const state = await getAccessState();
  if (!state.signedIn) redirect(`/login?next=${encodeURIComponent(`/o/${number}`)}`);
  if (!state.membership || !/^\d{1,15}$/.test(number)) notFound();
  const target = await orderLinkTarget(
    {
      userId: state.userId,
      orgId: state.membership.orgId,
      orgType: state.membership.orgType,
      orgStatus: state.membership.orgStatus,
    },
    Number(number),
  );
  if (!target) notFound();
  redirect(target);
  return null;
}
