import { describe, expect, it } from "vitest";
import { inviteTokenFromPath, normalizeEmail } from "@/lib/auth/invite-path";

const TOKEN = "A".repeat(43);

describe("inviteTokenFromPath", () => {
  it("extracts a 43-character token from /invite/<token>", () => {
    expect(inviteTokenFromPath(`/invite/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromPath(`/invite/${TOKEN}?x=1`)).toBe(TOKEN);
    expect(inviteTokenFromPath(`/invite/${TOKEN}/`)).toBe(TOKEN);
    const real = "Zm9vYmFyLV9iYXo-".padEnd(43, "x").replace("-", "_");
    expect(inviteTokenFromPath(`/invite/${real}`)).toBe(real);
  });

  it("rejects everything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "/",
      "/buyer",
      "/invite/",
      `/invite/${"A".repeat(42)}`,
      `/invite/${"A".repeat(44)}`,
      `/invite/${TOKEN}extra`,
      `/x/invite/${TOKEN}`,
      `//invite/${TOKEN}`,
      `/invite/${"A".repeat(42)}!`,
    ]) {
      expect(inviteTokenFromPath(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  G.Gadzadze@Gmail.COM ")).toBe("g.gadzadze@gmail.com");
  });
});
