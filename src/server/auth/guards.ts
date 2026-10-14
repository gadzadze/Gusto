import "server-only";
import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { organizationMemberships, organizations, profiles } from "@/server/db/schema";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  decideAccess,
  type AccessState,
  type OrgMembership,
  type Requirement,
} from "./access";

export type UserContext = { userId: string; email: string | null; isPlatformAdmin: boolean };
export type OrgContext = UserContext & OrgMembership;
export type BuyerContext = OrgContext & { orgType: "buyer" };
export type SupplierContext = OrgContext & { orgType: "supplier" };

/**
 * The current request's identity, loaded once per request.
 *
 * The user comes from `auth.getUser()`, which asks Supabase Auth to validate
 * the token — never from an unverified `getSession()`.
 */
export const getAccessState = cache(async (): Promise<AccessState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { signedIn: false };

  const rows = await getDb()
    .select({
      isPlatformAdmin: profiles.isPlatformAdmin,
      orgId: organizations.id,
      orgType: organizations.type,
      orgStatus: organizations.status,
      orgName: organizations.name,
      role: organizationMemberships.role,
    })
    .from(profiles)
    .leftJoin(organizationMemberships, eq(organizationMemberships.userId, profiles.id))
    .leftJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(profiles.id, data.user.id))
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1);

  const row = rows[0];
  const membership: OrgMembership | null =
    row?.orgId && row.orgType && row.orgStatus && row.orgName && row.role
      ? {
          orgId: row.orgId,
          orgType: row.orgType,
          orgStatus: row.orgStatus,
          orgName: row.orgName,
          role: row.role,
        }
      : null;

  return {
    signedIn: true,
    userId: data.user.id,
    email: data.user.email ?? null,
    isPlatformAdmin: row?.isPlatformAdmin ?? false,
    membership,
  };
});

async function enforce(requirement: Requirement) {
  const state = await getAccessState();
  switch (decideAccess(state, requirement)) {
    case "login":
      redirect("/login");
    case "onboarding":
      redirect("/onboarding");
    case "not_found":
      notFound();
    case "allow":
      if (!state.signedIn) throw new Error("unreachable");
      return state;
  }
}

function toUser(state: Extract<AccessState, { signedIn: true }>): UserContext {
  return { userId: state.userId, email: state.email, isPlatformAdmin: state.isPlatformAdmin };
}

function toOrg(state: Extract<AccessState, { signedIn: true }>): OrgContext {
  if (!state.membership) throw new Error("unreachable: org guard passed without membership");
  return { ...toUser(state), ...state.membership };
}

// Call one of these at the top of every page, Server Action and Route
// Handler that touches protected data. Layout checks are not enough: layouts
// don't re-run on client navigation and actions can be called directly.

export async function requireUser(): Promise<UserContext> {
  return toUser(await enforce("user"));
}

export async function requireOrg(): Promise<OrgContext> {
  return toOrg(await enforce("org"));
}

export async function requireBuyer(): Promise<BuyerContext> {
  return toOrg(await enforce("buyer")) as BuyerContext;
}

export async function requireSupplier(): Promise<SupplierContext> {
  return toOrg(await enforce("supplier")) as SupplierContext;
}

export async function requireAdmin(): Promise<UserContext & { isPlatformAdmin: true }> {
  return toUser(await enforce("admin")) as UserContext & { isPlatformAdmin: true };
}
