import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for OAuth tokens stored in the database. The key comes from
// TOKEN_ENCRYPTION_KEY (any long random string); it's hashed to 32 bytes.
function key(secret = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("Set TOKEN_ENCRYPTION_KEY (16+ random characters) before connecting accounts.");
  }
  return createHash("sha256").update(secret).digest();
}

/** Returns "v1.<iv>.<tag>.<data>" (base64url parts). */
export function encrypt(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(payload: string, secret?: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Stored token is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Couldn't decrypt the stored token. Was TOKEN_ENCRYPTION_KEY changed? Reconnect the account.");
  }
}
