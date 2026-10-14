import { describe, expect, it } from "vitest";
import { explainAdminApiError } from "@/server/supabase/admin";

const JWT_ERROR = "invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments";

describe("explainAdminApiError", () => {
  it("explains the sb_secret_ key problem and what to use instead", () => {
    const out = explainAdminApiError(JWT_ERROR, "sb_secret_abc123");
    expect(out).toContain(JWT_ERROR);
    expect(out).toContain('should start with "eyJ"');
    expect(out).toContain("supabase status -o env");
    expect(out).not.toContain("sb_secret_abc123"); // never echo the key
  });

  it("leaves other errors, and errors with a proper JWT key, alone", () => {
    expect(explainAdminApiError("Database error creating new user", "sb_secret_x")).toBe("Database error creating new user");
    expect(explainAdminApiError(JWT_ERROR, "eyJhbGciOi.payload.sig")).toBe(JWT_ERROR);
  });
});
