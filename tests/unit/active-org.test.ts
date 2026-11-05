import { describe, expect, it } from "vitest";
import type { OrgMembership } from "@/server/auth/access";
import { pickActive } from "@/server/auth/active-org";

const org = (orgId: string, orgType: "buyer" | "supplier", orgStatus: OrgMembership["orgStatus"] = "active"): OrgMembership => ({
  orgId,
  orgType,
  orgStatus,
  orgName: orgId,
  role: "owner",
});

describe("pickActive", () => {
  it("has nothing to pick without an organization", () => {
    expect(pickActive([], "x")).toBeNull();
  });

  it("uses the remembered side while the person is still a member", () => {
    const sides = [org("b", "buyer"), org("s", "supplier")];
    expect(pickActive(sides, "s")?.orgId).toBe("s");
  });

  it("ignores a cookie for an organization that is not theirs", () => {
    const sides = [org("b", "buyer"), org("s", "supplier")];
    expect(pickActive(sides, "someone-else")?.orgId).toBe("b");
    expect(pickActive(sides, null)?.orgId).toBe("b");
  });

  it("prefers a side that is already active over one waiting for review", () => {
    expect(pickActive([org("b", "buyer", "pending_review"), org("s", "supplier")], null)?.orgId).toBe("s");
    expect(pickActive([org("s", "supplier", "pending_review"), org("b", "buyer")], null)?.orgId).toBe("b");
  });

  it("when both wait, picks the supplier: it can prepare its catalog, a waiting buyer sees only the pending page", () => {
    expect(pickActive([org("b", "buyer", "pending_review"), org("s", "supplier", "pending_review")], null)?.orgId).toBe("s");
  });
});
