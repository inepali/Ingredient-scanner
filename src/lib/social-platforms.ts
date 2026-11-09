// TikTok and Instagram OAuth + publishing calls. Endpoints follow the official
// docs (TikTok Content Posting API, Instagram API with Instagram Login).

export type Platform = "tiktok" | "instagram" | "youtube";
export const PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"];
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

export function isPlatform(v: unknown): v is Platform {
  return v === "tiktok" || v === "instagram" || v === "youtube";
}

export const TIKTOK_PRIVACY = ["SELF_ONLY", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "PUBLIC_TO_EVERYONE"] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];

const TIKTOK_SCOPES = "user.info.basic,video.publish";
const IG_SCOPES = "instagram_business_basic,instagram_business_content_publish";
const YT_SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_PRIVACY = ["private", "unlisted", "public"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];
const IG_VERSION = process.env.INSTAGRAM_API_VERSION ?? "v23.0";

export type Tokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  externalId: string | null;
  scope: string | null;
};

export function redirectUri(origin: string, platform: Platform) {
  const base = (process.env.APP_URL || origin).replace(/\/$/, "");
  return `${base}/api/social/${platform}/callback`;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See "Connect Instagram and TikTok" in the README.`);
  return v;
}

export function authUrl(platform: Platform, redirect: string, state: string): string {
  if (platform === "tiktok") {
    const p = new URLSearchParams({
      client_key: need("TIKTOK_CLIENT_KEY"),
      scope: TIKTOK_SCOPES,
      response_type: "code",
      redirect_uri: redirect,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  }
  if (platform === "youtube") {
    const p = new URLSearchParams({
      client_id: need("YOUTUBE_CLIENT_ID"),
      redirect_uri: redirect,
      response_type: "code",
      scope: YT_SCOPES,
      access_type: "offline", // so Google returns a refresh token
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  const p = new URLSearchParams({
    client_id: need("INSTAGRAM_APP_ID"),
    redirect_uri: redirect,
    response_type: "code",
    scope: IG_SCOPES,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${p}`;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // keep empty
  }
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${apiMessage(body) || text.slice(0, 200)}`);
  return body;
}

/** Pulls a readable message out of either platform's error shapes. */
export function apiMessage(body: Record<string, unknown>): string {
  const err = body.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return [err, body.error_description].filter(Boolean).join(": ");
  if (err && typeof err === "object") {
    const code = err.code && err.code !== "ok" ? String(err.code) : "";
    const msg = (err.message ?? err.error_user_msg ?? "") as string;
    return [code, msg].filter(Boolean).join(": ");
  }
  if (typeof body.error_message === "string") return body.error_message;
  return "";
}

const inSeconds = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(Date.now() + s * 1000) : null);

export function parseTikTokTokens(body: Record<string, unknown>): Tokens {
  if (typeof body.access_token !== "string") {
    throw new Error(`TikTok didn't return a token: ${apiMessage(body) || JSON.stringify(body).slice(0, 200)}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: inSeconds(body.expires_in),
    refreshExpiresAt: inSeconds(body.refresh_expires_in),
    externalId: typeof body.open_id === "string" ? body.open_id : null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export function parseGoogleTokens(body: Record<string, unknown>): Tokens {
  if (typeof body.access_token !== "string") {
    throw new Error(`Google didn't return a token: ${apiMessage(body) || JSON.stringify(body).slice(0, 200)}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: inSeconds(body.expires_in),
    refreshExpiresAt: null,
    externalId: null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

async function googleToken(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: need("YOUTUBE_CLIENT_ID"), client_secret: need("YOUTUBE_CLIENT_SECRET"), ...params }),
  });
  return parseGoogleTokens(await readJson(res, "Google sign-in"));
}

async function tiktokToken(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: need("TIKTOK_CLIENT_KEY"), client_secret: need("TIKTOK_CLIENT_SECRET"), ...params }),
  });
  return parseTikTokTokens(await readJson(res, "TikTok sign-in"));
}

export async function exchangeCode(platform: Platform, code: string, redirect: string): Promise<Tokens & { accountName: string | null }> {
  if (platform === "tiktok") {
    const t = await tiktokToken({ code, grant_type: "authorization_code", redirect_uri: redirect });
    let name: string | null = null;
    try {
      const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", {
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });
      const body = await readJson(res, "TikTok profile");
      name = ((body.data as { user?: { display_name?: string } } | undefined)?.user?.display_name) ?? null;
    } catch {
      // the name is cosmetic
    }
    return { ...t, accountName: name };
  }

  if (platform === "youtube") {
    const t = await googleToken({ code, grant_type: "authorization_code", redirect_uri: redirect });
    if (!t.refreshToken) {
      throw new Error("Google didn't return a refresh token. Remove this app at myaccount.google.com/permissions and connect again.");
    }
    let name: string | null = null;
    let id: string | null = null;
    try {
      const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });
      const body = await readJson(res, "YouTube channel");
      const item = (body.items as { id?: string; snippet?: { title?: string } }[] | undefined)?.[0];
      name = item?.snippet?.title ?? null;
      id = item?.id ?? null;
    } catch {
      // cosmetic
    }
    return { ...t, externalId: id, accountName: name };
  }

  // Instagram: short-lived token first, then swap it for a 60-day one.
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: need("INSTAGRAM_APP_ID"),
      client_secret: need("INSTAGRAM_APP_SECRET"),
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code,
    }),
  });
  const shortBody = await readJson(shortRes, "Instagram sign-in");
  const first = (Array.isArray(shortBody.data) ? (shortBody.data as Record<string, unknown>[])[0] : shortBody) ?? shortBody;
  if (typeof first.access_token !== "string") throw new Error("Instagram didn't return a token.");

  const longRes = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: need("INSTAGRAM_APP_SECRET"),
      access_token: first.access_token,
    })}`,
  );
  const longBody = await readJson(longRes, "Instagram token exchange");
  const token = typeof longBody.access_token === "string" ? longBody.access_token : first.access_token;

  let name: string | null = null;
  let id: string | null = first.user_id != null ? String(first.user_id) : null;
  try {
    const me = await readJson(
      await fetch(`https://graph.instagram.com/${IG_VERSION}/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`),
      "Instagram profile",
    );
    name = typeof me.username === "string" ? me.username : null;
    if (me.user_id != null) id = String(me.user_id);
  } catch {
    // cosmetic
  }
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: inSeconds(longBody.expires_in) ?? new Date(Date.now() + 60 * 86400 * 1000),
    refreshExpiresAt: null,
    externalId: id,
    scope: IG_SCOPES,
    accountName: name,
  };
}

/** True when the stored token should be renewed before use. */
export function needsRefresh(platform: Platform, expiresAt: Date | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const left = expiresAt.getTime() - now;
  return left < (platform === "instagram" ? 7 * 86_400_000 : 10 * 60_000);
}

export async function refreshTokens(platform: Platform, current: { accessToken: string; refreshToken: string | null }): Promise<Tokens> {
  if (platform === "tiktok") {
    if (!current.refreshToken) throw new Error("TikTok session expired. Reconnect TikTok.");
    return tiktokToken({ grant_type: "refresh_token", refresh_token: current.refreshToken });
  }
  if (platform === "youtube") {
    if (!current.refreshToken) throw new Error("YouTube session expired. Reconnect YouTube.");
    return googleToken({ grant_type: "refresh_token", refresh_token: current.refreshToken });
  }
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: current.accessToken })}`,
  );
  const body = await readJson(res, "Instagram token refresh");
  if (typeof body.access_token !== "string") throw new Error("Instagram didn't return a refreshed token.");
  return {
    accessToken: body.access_token,
    refreshToken: null,
    expiresAt: inSeconds(body.expires_in),
    refreshExpiresAt: null,
    externalId: null,
    scope: null,
  };
}

/** Title + description + hashtags as one caption, cut to the 2200-character limit both apps share. */
export function buildCaption(c: { title: string; description: string; hashtags: string[] }, max = 2200): string {
  const tags = c.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  const full = [c.title.trim(), c.description.trim(), tags].filter(Boolean).join("\n\n");
  if (full.length <= max) return full;
  // Keep the hashtags; trim the description.
  const head = [c.title.trim()].filter(Boolean).join("\n\n");
  const room = max - head.length - tags.length - 4;
  const desc = room > 20 ? c.description.trim().slice(0, room - 1).trimEnd() + "…" : "";
  return [head, desc, tags].filter(Boolean).join("\n\n").slice(0, max);
}

// ---------- TikTok publishing ----------

export type TikTokInit = { publishId: string };

/** coverSeconds: which moment of the video becomes the thumbnail. The video uses an AI voice, so it is always labelled as AI-generated, as TikTok requires. */
export function tiktokInitBody(caption: string, privacy: TikTokPrivacy, size: number, coverSeconds = 1) {
  const cover = Number.isFinite(coverSeconds) ? Math.min(60, Math.max(0, coverSeconds)) : 1;
  return {
    post_info: {
      title: caption,
      privacy_level: privacy,
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      is_aigc: true,
      video_cover_timestamp_ms: Math.round(cover * 1000),
    },
    // One chunk covering the whole file (allowed up to 64 MB).
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  };
}

export async function tiktokCreatorOptions(token: string): Promise<{ privacy: string[]; nickname: string | null }> {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
  });
  const body = await readJson(res, "TikTok creator info");
  const data = (body.data ?? {}) as { privacy_level_options?: string[]; creator_nickname?: string };
  return { privacy: data.privacy_level_options ?? [], nickname: data.creator_nickname ?? null };
}

export async function tiktokPost(token: string, video: Buffer, caption: string, privacy: TikTokPrivacy, coverSeconds = 1): Promise<TikTokInit> {
  const opts = await tiktokCreatorOptions(token);
  if (opts.privacy.length && !opts.privacy.includes(privacy)) {
    throw new Error(`TikTok doesn't allow "${privacy}" for this account right now. Allowed: ${opts.privacy.join(", ")}.`);
  }
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(tiktokInitBody(caption, privacy, video.length, coverSeconds)),
  });
  const body = await readJson(res, "TikTok upload start");
  const data = (body.data ?? {}) as { publish_id?: string; upload_url?: string };
  if (!data.publish_id || !data.upload_url) throw new Error(`TikTok upload start failed: ${apiMessage(body) || "no upload URL"}`);

  const put = await fetch(data.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.length),
      "Content-Range": `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: new Uint8Array(video),
  });
  if (!put.ok && put.status !== 201) throw new Error(`TikTok upload failed (${put.status}).`);
  return { publishId: data.publish_id };
}

export type PostState = { status: "processing" | "published" | "failed"; detail?: string; permalink?: string };

export function mapTikTokStatus(s: string | undefined, failReason?: string): PostState {
  if (s === "PUBLISH_COMPLETE") return { status: "published" };
  if (s === "FAILED") return { status: "failed", detail: failReason || "TikTok rejected the video." };
  return { status: "processing", detail: s };
}

export async function tiktokStatus(token: string, publishId: string): Promise<PostState> {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const body = await readJson(res, "TikTok status");
  const d = (body.data ?? {}) as { status?: string; fail_reason?: string };
  return mapTikTokStatus(d.status, d.fail_reason);
}

// ---------- Instagram publishing ----------

const igBase = `https://graph.instagram.com/${IG_VERSION}`;

/** Step 1: ask Instagram to fetch the video from a public URL and prepare a Reel. */
export async function instagramCreateReel(token: string, igId: string, videoUrl: string, caption: string): Promise<string> {
  const res = await fetch(`${igBase}/${igId}/media`, {
    method: "POST",
    body: new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: token }),
  });
  const body = await readJson(res, "Instagram Reel upload");
  if (typeof body.id !== "string") throw new Error("Instagram didn't return a container id.");
  return body.id;
}

export function mapInstagramStatus(code: string | undefined, detail?: string): "ready" | PostState {
  if (code === "FINISHED") return "ready";
  if (code === "PUBLISHED") return { status: "published" };
  if (code === "ERROR") return { status: "failed", detail: detail || "Instagram couldn't process the video." };
  if (code === "EXPIRED") return { status: "failed", detail: "The upload expired (24 hours). Post it again." };
  return { status: "processing", detail: code };
}

/** Step 2/3: check the container; publish it once Instagram says it's ready. */
export async function instagramAdvance(token: string, igId: string, containerId: string): Promise<PostState> {
  const res = await fetch(`${igBase}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`);
  const body = await readJson(res, "Instagram status");
  const mapped = mapInstagramStatus(body.status_code as string | undefined, body.status as string | undefined);
  if (mapped !== "ready") return mapped;

  const pub = await readJson(
    await fetch(`${igBase}/${igId}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    }),
    "Instagram publish",
  );
  let permalink: string | undefined;
  try {
    if (typeof pub.id === "string") {
      const m = await readJson(await fetch(`${igBase}/${pub.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`), "Instagram link");
      permalink = typeof m.permalink === "string" ? m.permalink : undefined;
    }
  } catch {
    // the link is a nicety
  }
  return { status: "published", permalink };
}

// ---------- YouTube publishing ----------

/** Hashtags shown in the description. YouTube ignores ALL of them if there are more than 15, and shows the first 3 above the title. */
export const YOUTUBE_DESCRIPTION_TAGS = 5;

/**
 * YouTube title (max 100), description (max 5000) and hidden tags (max 500 characters in total).
 * Every hashtag becomes a hidden tag; only the first few are written into the description.
 */
export function youtubeMetadata(
  c: { title: string; description: string; hashtags: string[] },
  privacy: YouTubePrivacy,
) {
  const title = (c.title.trim() || "Ingredient check").slice(0, 100);
  const tags = c.hashtags.slice(0, YOUTUBE_DESCRIPTION_TAGS - 1).map((h) => `#${h.replace(/^#/, "")}`);
  if (!tags.some((t) => t.toLowerCase() === "#shorts")) tags.push("#Shorts");
  const description = [c.description.trim(), tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 5000);
  const keywords: string[] = [];
  let used = 0;
  for (const h of c.hashtags) {
    const k = h.replace(/^#/, "");
    if (!k || used + k.length + 1 > 450) continue;
    keywords.push(k);
    used += k.length + 1;
  }
  return {
    snippet: { title, description, tags: keywords, categoryId: "26" /* Howto & Style */ },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  };
}

/** Uploads the video with YouTube's resumable protocol (one PUT). Returns the new video id. */
export async function youtubeUpload(token: string, video: Buffer, meta: ReturnType<typeof youtubeMetadata>): Promise<string> {
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(video.length),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const text = await init.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not JSON
    }
    const msg = apiMessage(body) || text.slice(0, 200);
    if (/quota/i.test(msg)) throw new Error("YouTube's daily upload quota is used up. Try again tomorrow.");
    throw new Error(`YouTube upload start failed (${init.status}): ${msg}`);
  }
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube didn't return an upload address.");

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(video.length) },
    body: new Uint8Array(video),
  });
  const body = await readJson(put, "YouTube upload");
  if (typeof body.id !== "string") throw new Error("YouTube accepted the file but returned no video id.");
  return body.id;
}

export const youtubeUrl = (videoId: string) => `https://www.youtube.com/shorts/${videoId}`;
