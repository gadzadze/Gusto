import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// A company's RS.ge service user is a credential that can create tax documents in its name, so it is stored
// encrypted (AES-256-GCM) with a key that lives only in the environment (RSGE_ENCRYPTION_KEY, 32 random bytes,
// base64). The database alone is not enough to read it. Format: "v1.<iv>.<tag>.<data>" (base64url).

function key(): Buffer {
  const raw = process.env.RSGE_ENCRYPTION_KEY;
  const bytes = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (bytes.length !== 32) throw new Error("RSGE_ENCRYPTION_KEY must be 32 random bytes, base64 encoded.");
  return bytes;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable secret.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Whether a key is configured at all (the connect form is hidden without one). */
export function secretsConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
