import test from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto.ts";
import {
  authUrl, buildCaption, parseGoogleTokens, youtubeMetadata, mapInstagramStatus, mapTikTokStatus, needsRefresh, parseTikTokTokens, tiktokInitBody, apiMessage,
} from "./social-platforms.ts";

const KEY = "a-long-test-secret-value";

test("encrypt/decrypt round-trips and rejects tampering or a wrong key", () => {
  const enc = encrypt("tok_123", KEY);
  assert.ok(!enc.includes("tok_123"));
  assert.equal(decrypt(enc, KEY), "tok_123");
  assert.notEqual(encrypt("tok_123", KEY), enc); // random IV
  assert.throws(() => decrypt(enc, "another-long-secret-value"));
  const parts = enc.split(".");
  parts[3] = Buffer.from("xx").toString("base64url");
  assert.throws(() => decrypt(parts.join("."), KEY));
  assert.throws(() => encrypt("x", "short"));
});

test("auth URLs carry client id, scopes, redirect and state", () => {
  process.env.TIKTOK_CLIENT_KEY = "ck";
  process.env.INSTAGRAM_APP_ID = "iid";
  const t = new URL(authUrl("tiktok", "https://x.app/api/social/tiktok/callback", "st"));
  assert.equal(t.origin + t.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(t.searchParams.get("client_key"), "ck");
  assert.match(t.searchParams.get("scope")!, /video\.publish/);
  assert.equal(t.searchParams.get("state"), "st");
  const i = new URL(authUrl("instagram", "https://x.app/api/social/instagram/callback", "s2"));
  assert.equal(i.searchParams.get("client_id"), "iid");
  assert.match(i.searchParams.get("scope")!, /instagram_business_content_publish/);
  delete process.env.TIKTOK_CLIENT_KEY;
  assert.throws(() => authUrl("tiktok", "r", "s"), /TIKTOK_CLIENT_KEY/);
});

test("TikTok token response parsing", () => {
  const t = parseTikTokTokens({ access_token: "a", refresh_token: "r", expires_in: 86400, refresh_expires_in: 31536000, open_id: "o" });
  assert.equal(t.accessToken, "a");
  assert.equal(t.refreshToken, "r");
  assert.equal(t.externalId, "o");
  assert.ok(t.expiresAt!.getTime() > Date.now());
  assert.throws(() => parseTikTokTokens({ error: "invalid_grant", error_description: "bad code" }), /invalid_grant: bad code/);
});

test("refresh timing", () => {
  const now = Date.now();
  assert.equal(needsRefresh("tiktok", new Date(now + 3600_000), now), false);
  assert.equal(needsRefresh("tiktok", new Date(now + 60_000), now), true);
  assert.equal(needsRefresh("instagram", new Date(now + 3 * 86400_000), now), true);
  assert.equal(needsRefresh("instagram", new Date(now + 30 * 86400_000), now), false);
  assert.equal(needsRefresh("instagram", null, now), false);
});

test("caption keeps hashtags and the 2200 limit", () => {
  const c = buildCaption({ title: "Title", description: "Body", hashtags: ["a", "#b"] });
  assert.equal(c, "Title\n\nBody\n\n#a #b");
  const long = buildCaption({ title: "T", description: "x".repeat(5000), hashtags: ["keep"] });
  assert.ok(long.length <= 2200);
  assert.ok(long.endsWith("#keep"));
});

test("TikTok init body uses one whole-file chunk", () => {
  const b = tiktokInitBody("cap", "SELF_ONLY", 1234);
  assert.equal(b.post_info.is_aigc, true);
  assert.equal(b.post_info.video_cover_timestamp_ms, 1000);
  assert.equal(tiktokInitBody("c", "SELF_ONLY", 1, 2.5).post_info.video_cover_timestamp_ms, 2500);
  assert.equal(tiktokInitBody("c", "SELF_ONLY", 1, 999).post_info.video_cover_timestamp_ms, 60000);
  assert.equal(b.source_info.source, "FILE_UPLOAD");
  assert.equal(b.source_info.chunk_size, 1234);
  assert.equal(b.source_info.total_chunk_count, 1);
  assert.equal(b.post_info.privacy_level, "SELF_ONLY");
});

test("status mapping", () => {
  assert.equal(mapTikTokStatus("PUBLISH_COMPLETE").status, "published");
  assert.equal(mapTikTokStatus("PROCESSING_UPLOAD").status, "processing");
  assert.equal(mapTikTokStatus("FAILED", "bad").detail, "bad");
  assert.equal(mapInstagramStatus("FINISHED"), "ready");
  assert.deepEqual(mapInstagramStatus("IN_PROGRESS"), { status: "processing", detail: "IN_PROGRESS" });
  assert.equal((mapInstagramStatus("ERROR") as { status: string }).status, "failed");
  assert.equal((mapInstagramStatus("EXPIRED") as { status: string }).status, "failed");
});

test("error messages from both platforms", () => {
  assert.equal(apiMessage({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "m" } }), "unaudited_client_can_only_post_to_private_accounts: m");
  assert.equal(apiMessage({ error: { code: "ok", message: "" } }), "");
  assert.equal(apiMessage({ error: { message: "Invalid token" } }), "Invalid token");
});

import { withPublicLink } from "./public-link.ts";

test("public link goes right after the not-medical-advice line", () => {
  const url = "https://x.app/p/abc";
  assert.equal(
    withPublicLink("Great label.\n\nNot medical advice.", url),
    "Great label.\n\nNot medical advice.\n\nFull ingredient breakdown: https://x.app/p/abc",
  );
  assert.equal(
    withPublicLink("Intro. Not medical advice. More text.", url),
    "Intro. Not medical advice.\n\nFull ingredient breakdown: https://x.app/p/abc\n\nMore text.",
  );
  assert.equal(withPublicLink("No note here.", url), "No note here.\n\nFull ingredient breakdown: https://x.app/p/abc");
  assert.equal(withPublicLink("Text", null), "Text");
  const done = withPublicLink("Text, not medical advice.", url);
  assert.equal(withPublicLink(done, url), done); // no double link
});

test("YouTube sign-in URL asks for offline access and upload scope", () => {
  process.env.YOUTUBE_CLIENT_ID = "yid";
  const u = new URL(authUrl("youtube", "https://x.app/api/social/youtube/callback", "st"));
  assert.equal(u.origin, "https://accounts.google.com");
  assert.equal(u.searchParams.get("client_id"), "yid");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.match(u.searchParams.get("scope")!, /youtube\.upload/);
});

test("Google tokens and YouTube metadata", () => {
  const t = parseGoogleTokens({ access_token: "a", refresh_token: "r", expires_in: 3599 });
  assert.equal(t.refreshToken, "r");
  assert.ok(t.expiresAt!.getTime() > Date.now());
  assert.throws(() => parseGoogleTokens({ error: "invalid_grant", error_description: "Bad code" }), /invalid_grant: Bad code/);

  const m = youtubeMetadata({ title: "x".repeat(150), description: "Desc", hashtags: ["a", "#b"] }, "unlisted");
  assert.equal(m.snippet.title.length, 100);
  assert.equal(m.status.privacyStatus, "unlisted");
  assert.equal(m.status.selfDeclaredMadeForKids, false);
  assert.match(m.snippet.description, /#a #b #Shorts/);
  assert.deepEqual(m.snippet.tags, ["a", "b"]);

  // 20 hashtags: all become hidden tags, but only a few go in the description (YouTube drops them all above 15).
  const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
  const big = youtubeMetadata({ title: "t", description: "d", hashtags: many }, "private");
  assert.equal(big.snippet.tags.length, 20);
  assert.equal((big.snippet.description.match(/#/g) ?? []).length, 5);
  assert.match(big.snippet.description, /#tag0 #tag1 #tag2 #tag3 #Shorts/);
});

test("public link sits between the disclaimer and the data credit", () => {
  const out = withPublicLink("Nice.\n\nDo you eat this?\n\nNot medical advice.\n\nProduct data: Open Food Facts", "https://x.app/p/abc");
  assert.equal(out, "Nice.\n\nDo you eat this?\n\nNot medical advice.\n\nFull ingredient breakdown: https://x.app/p/abc\n\nProduct data: Open Food Facts");
});
