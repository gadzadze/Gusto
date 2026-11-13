import { redirect } from "next/navigation";
import { homePathFor } from "@/server/auth/access";
import { claimTeamInvites } from "@/server/domain/team/team";
import { getAccessState } from "@/server/auth/guards";

// Default post-sign-in destination: sends each person to the right area.
export async function GET() {
  const state = await getAccessState();
  // Someone already signed in who was added to a company since: join it before choosing the destination.
  if (state.signedIn && state.email && (await claimTeamInvites(state.userId, state.email))) redirect(homePathFor(await getAccessState()));
  redirect(homePathFor(state));
}
