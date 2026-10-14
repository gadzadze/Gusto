import { describe, expect, it } from "vitest";
import { decideAccess, homePathFor, type AccessState, type Requirement } from "@/server/auth/access";

const signedOut: AccessState = { signedIn: false };
const noOrg: AccessState = {
  signedIn: true,
  userId: "u1",
  email: "a@b.ge",
  isPlatformAdmin: false,
  membership: null,
};
const withOrg = (orgType: "buyer" | "supplier", isPlatformAdmin = false): AccessState => ({
  signedIn: true,
  userId: "u1",
  email: "a@b.ge",
  isPlatformAdmin,
  membership: {
    orgId: "o1",
    orgType,
    orgStatus: orgType === "buyer" ? "active" : "pending_review",
    orgName: "Org",
    role: "owner",
  },
});

describe("decideAccess", () => {
  const requirements: Requirement[] = ["user", "org", "buyer", "supplier", "admin"];

  it("sends signed-out visitors to login for every requirement", () => {
    for (const r of requirements) expect(decideAccess(signedOut, r)).toBe("login");
  });

  it("sends signed-in users without an org to onboarding for org areas", () => {
    expect(decideAccess(noOrg, "user")).toBe("allow");
    expect(decideAccess(noOrg, "org")).toBe("onboarding");
    expect(decideAccess(noOrg, "buyer")).toBe("onboarding");
    expect(decideAccess(noOrg, "supplier")).toBe("onboarding");
  });

  it("returns not_found (not a redirect) for the wrong role", () => {
    expect(decideAccess(withOrg("buyer"), "supplier")).toBe("not_found");
    expect(decideAccess(withOrg("supplier"), "buyer")).toBe("not_found");
    expect(decideAccess(withOrg("buyer"), "admin")).toBe("not_found");
    expect(decideAccess(noOrg, "admin")).toBe("not_found");
  });

  it("allows the matching role", () => {
    expect(decideAccess(withOrg("buyer"), "buyer")).toBe("allow");
    expect(decideAccess(withOrg("supplier"), "supplier")).toBe("allow");
    expect(decideAccess(withOrg("supplier"), "org")).toBe("allow");
  });

  it("allows platform admins into admin regardless of org", () => {
    expect(decideAccess(withOrg("buyer", true), "admin")).toBe("allow");
    expect(decideAccess({ ...noOrg, isPlatformAdmin: true }, "admin")).toBe("allow");
  });

  it("does not let admin rights substitute for an org role", () => {
    expect(decideAccess(withOrg("buyer", true), "supplier")).toBe("not_found");
  });
});

describe("homePathFor", () => {
  it("routes each kind of user to their area", () => {
    expect(homePathFor(signedOut)).toBe("/login");
    expect(homePathFor(noOrg)).toBe("/onboarding");
    expect(homePathFor({ ...noOrg, isPlatformAdmin: true })).toBe("/admin");
    expect(homePathFor(withOrg("buyer"))).toBe("/buyer");
    expect(homePathFor(withOrg("supplier", true))).toBe("/supplier");
  });
});
