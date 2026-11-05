import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-next";
import { homePathFor } from "@/server/auth/access";
import { ACTIVE_ORG_COOKIE } from "@/server/auth/active-org";
import { getAccessState } from "@/server/auth/guards";

// A person with both a buyer and a supplier side chooses which one they act as:
// /switch?org=<their organization>&next=<same-site path>. Only the person's own
// organizations are accepted; anything else leaves the current choice alone.
export async function GET(request: NextRequest) {
  // Next prefetches links in the background (RSC requests): that must never change the choice.
  if (request.nextUrl.searchParams.has("_rsc") || request.headers.has("rsc") || request.headers.has("next-router-prefetch")) {
    return new NextResponse(null, { status: 204 });
  }
  const state = await getAccessState();
  const org = request.nextUrl.searchParams.get("org");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  if (!state.signedIn) redirect(`/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`);
  const target = state.memberships.find((m) => m.orgId === org);
  if (!target) redirect(homePathFor(state));
  (await cookies()).set(ACTIVE_ORG_COOKIE, target.orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(next ?? homePathFor({ ...state, membership: target }));
}
