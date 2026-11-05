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
  if (state.memberships.length === 0 || !/^\d{1,15}$/.test(number)) notFound();
  // A person with both a buyer and a supplier side: the order belongs to whichever of their
  // sides is a party to it. Look at the chosen side first, then the other one.
  const ordered = [...state.memberships].sort((a, b) => Number(b.orgId === state.membership?.orgId) - Number(a.orgId === state.membership?.orgId));
  for (const m of ordered) {
    const found = await orderLinkTarget(
      { userId: state.userId, orgId: m.orgId, orgType: m.orgType, orgStatus: m.orgStatus },
      Number(number),
    );
    if (!found) continue;
    if (m.orgId === state.membership?.orgId) redirect(found);
    redirect(`/switch?org=${m.orgId}&next=${encodeURIComponent(found)}`);
  }
  notFound();
  return null;
}
