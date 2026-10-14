import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Invitation tokens: 32 random bytes, base64url. Only the SHA-256 hash is
// stored, so a database leak doesn't leak working links.

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Shape check before touching the database: 32 bytes base64url = 43 chars. */
export function looksLikeInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export type InvitationState = {
  expiresAt: Date;
  revokedAt: Date | null;
  acceptedAt: Date | null;
};

export function isInvitationUsable(inv: InvitationState, now: Date = new Date()): boolean {
  return inv.revokedAt === null && inv.acceptedAt === null && inv.expiresAt.getTime() > now.getTime();
}
