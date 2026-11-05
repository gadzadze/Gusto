import type { OrgMembership } from "./access";

/** The cookie that remembers which of a person's organizations they are acting as. */
export const ACTIVE_ORG_COOKIE = "gusto-org";

/**
 * Which organization a request belongs to. The remembered choice counts only while the
 * person is still a member (a stale or forged cookie is ignored); otherwise the first
 * organization that is already active (a pending side must not hide the working one),
 * then a supplier (a waiting supplier can prepare its catalog; a waiting buyer sees only
 * the pending page), else the first. The list is ordered by when they joined, buyer
 * before supplier.
 */
export function pickActive(memberships: readonly OrgMembership[], preferredOrgId: string | null | undefined): OrgMembership | null {
  if (memberships.length === 0) return null;
  const preferred = preferredOrgId ? memberships.find((m) => m.orgId === preferredOrgId) : undefined;
  return (
    preferred ??
    memberships.find((m) => m.orgStatus === "active") ??
    memberships.find((m) => m.orgType === "supplier") ??
    memberships[0]
  );
}
