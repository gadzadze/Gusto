import { redirect } from "next/navigation";
import { homePathFor } from "@/server/auth/access";
import { getAccessState } from "@/server/auth/guards";

// Default post-sign-in destination: sends each person to the right area.
export async function GET() {
  redirect(homePathFor(await getAccessState()));
}
