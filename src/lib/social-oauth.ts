import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { newState, requireGuard, sameState, saveAccount, stateCookie } from "./social-accounts";
import { authUrl, exchangeCode, redirectUri, type Platform } from "./social-platforms";

const secure = (req: Request) => new URL(req.url).protocol === "https:";

/** Starts sign-in: sets a one-time state cookie and sends the browser to the platform. */
export function startConnect(req: Request, platform: Platform) {
  requireGuard();
  const state = newState();
  const url = authUrl(platform, redirectUri(new URL(req.url).origin, platform), state);
  const res = NextResponse.redirect(url);
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: secure(req), maxAge: 600, path: "/" };
  res.cookies.set(stateCookie(platform), state, opts);
  const scan = new URL(req.url).searchParams.get("scan");
  if (scan && /^[0-9a-f-]{36}$/i.test(scan)) res.cookies.set("social_return", scan, opts);
  return res;
}

/** The platform sends the browser back here with ?code=…&state=…; always ends on the scan page or home. */
export async function finishConnect(req: Request, platform: Platform) {
  const url = new URL(req.url);
  const back = (msg: string, ok = false) => {
    const scan = req.headers.get("cookie")?.match(/social_return=([0-9a-f-]{36})/i)?.[1];
    const to = new URL(scan ? `/scans/${scan}` : "/", url.origin);
    to.hash = "post";
    to.searchParams.set(ok ? "social_ok" : "social_error", msg);
    const res = NextResponse.redirect(to);
    res.cookies.delete(stateCookie(platform));
    res.cookies.delete("social_return");
    return res;
  };
  try {
    requireGuard();
    const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (denied) return back(denied);
    const cookie = req.headers.get("cookie")?.match(new RegExp(`${stateCookie(platform)}=([^;]+)`))?.[1];
    if (!sameState(cookie, url.searchParams.get("state"))) {
      throw new HttpError("Sign-in check failed (state mismatch). Start the connection again.");
    }
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError("No authorization code came back.");
    const t = await exchangeCode(platform, code.replace(/#_$/, ""), redirectUri(url.origin, platform));
    await saveAccount(platform, t, t.accountName);
    return back(`${platform} connected`, true);
  } catch (err) {
    console.error(err);
    return back(err instanceof Error ? err.message : "Could not connect.");
  }
}
