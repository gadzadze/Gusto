import type { MembershipRole, OrgStatus, OrgType } from "@/server/db/schema";

// Pure access rules, kept free of Next.js and database calls so they can be
// unit-tested. guards.ts loads the state and turns decisions into
// redirect()/notFound().

export type Requirement = "user" | "org" | "buyer" | "supplier" | "admin";

export type OrgMembership = {
  orgId: string;
  orgType: OrgType;
  orgStatus: OrgStatus;
  orgName: string;
  role: MembershipRole;
};

export type AccessState =
  | { signedIn: false }
  | {
      signedIn: true;
      userId: string;
      email: string | null;
      isPlatformAdmin: boolean;
      membership: OrgMembership | null;
    };

export type AccessDecision = "allow" | "login" | "onboarding" | "not_found";

export function decideAccess(state: AccessState, requirement: Requirement): AccessDecision {
  if (!state.signedIn) return "login";
  switch (requirement) {
    case "user":
      return "allow";
    case "admin":
      // Wrong role is a 404, not a 403, so the area can't be discovered.
      return state.isPlatformAdmin ? "allow" : "not_found";
    case "org":
    case "buyer":
    case "supplier": {
      if (!state.membership) return "onboarding";
      if (requirement === "org") return "allow";
      return state.membership.orgType === requirement ? "allow" : "not_found";
    }
  }
}

/** Where a signed-in user lands by default. */
export function homePathFor(state: AccessState): string {
  if (!state.signedIn) return "/login";
  if (!state.membership) return state.isPlatformAdmin ? "/admin" : "/onboarding";
  return state.membership.orgType === "buyer" ? "/buyer" : "/supplier";
}
