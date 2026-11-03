import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/auth/invite-path";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  G.Gadzadze@Gmail.COM ")).toBe("g.gadzadze@gmail.com");
  });
});
