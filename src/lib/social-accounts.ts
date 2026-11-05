import { randomBytes, timingSafeEqual } from "node:crypto";
import { supabase } from "./supabase";
import { decrypt, encrypt } from "./crypto";
import { HttpError } from "./http";
import { PLATFORM_LABEL, needsRefresh, refreshTokens, type Platform, type Tokens } from "./social-platforms";

export type AccountRow = {
  platform: Platform;
  external_id: string | null;
  account_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
};

/**
 * Connected accounts can post as you, and this tool has no login. So connecting
 * and posting need APP_PASSWORD set (middleware then asks for it on every page).
 */
export function requireGuard() {
  if (!process.env.APP_PASSWORD) {
    throw new HttpError(
      "Set APP_PASSWORD first. Connecting accounts lets this app post as you, so the app needs a password before that's allowed.",
      403,
    );
  }
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const stateCookie = (p: Platform) => `social_state_${p}`;

export async function saveAccount(platform: Platform, t: Tokens, accountName: string | null) {
  const { error } = await supabase()
    .from("social_accounts")
    .upsert({
      platform,
      external_id: t.externalId,
      account_name: accountName,
      access_token_enc: encrypt(t.accessToken),
      refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : null,
      expires_at: t.expiresAt?.toISOString() ?? null,
      refresh_expires_at: t.refreshExpiresAt?.toISOString() ?? null,
      scope: t.scope,
      connected_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message);
}

export async function getAccount(platform: Platform): Promise<AccountRow | null> {
  const { data, error } = await supabase().from("social_accounts").select("*").eq("platform", platform).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AccountRow | null) ?? null;
}

export async function removeAccount(platform: Platform) {
  const { error } = await supabase().from("social_accounts").delete().eq("platform", platform);
  if (error) throw new Error(error.message);
}

/** A valid access token plus the account's id; renews it first if it's about to expire. */
export async function liveToken(platform: Platform): Promise<{ token: string; externalId: string | null; name: string | null }> {
  const acc = await getAccount(platform);
  if (!acc) throw new HttpError(`${PLATFORM_LABEL[platform]} isn't connected.`, 400);
  let token = decrypt(acc.access_token_enc);
  const expires = acc.expires_at ? new Date(acc.expires_at) : null;
  if (needsRefresh(platform, expires)) {
    try {
      const next = await refreshTokens(platform, {
        accessToken: token,
        refreshToken: acc.refresh_token_enc ? decrypt(acc.refresh_token_enc) : null,
      });
      await supabase()
        .from("social_accounts")
        .update({
          access_token_enc: encrypt(next.accessToken),
          refresh_token_enc: next.refreshToken ? encrypt(next.refreshToken) : acc.refresh_token_enc,
          expires_at: next.expiresAt?.toISOString() ?? null,
          refresh_expires_at: next.refreshExpiresAt?.toISOString() ?? acc.refresh_expires_at,
          refreshed_at: new Date().toISOString(),
        })
        .eq("platform", platform);
      token = next.accessToken;
    } catch (err) {
      if (expires && expires.getTime() < Date.now()) {
        throw new HttpError(`${err instanceof Error ? err.message : "Token expired."} Reconnect the account.`, 401);
      }
      // still valid for now; try with it
    }
  }
  return { token, externalId: acc.external_id, name: acc.account_name };
}
