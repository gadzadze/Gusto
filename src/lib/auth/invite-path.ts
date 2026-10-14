/**
 * The invitation token in a post-sign-in path like `/invite/<token>`, or null.
 * Shape check only (43 base64url characters); whether the token works is a
 * database question (server/auth/allow-list.ts).
 */
export function inviteTokenFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const m = /^\/invite\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/.exec(path);
  return m ? m[1] : null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
