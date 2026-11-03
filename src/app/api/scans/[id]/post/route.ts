import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { getMedia, mediaUrl } from "@/lib/storage";
import { liveToken, requireGuard } from "@/lib/social-accounts";
import {
  TIKTOK_PRIVACY,
  buildCaption,
  instagramCreateReel,
  isPlatform,
  tiktokPost,
  type TikTokPrivacy,
} from "@/lib/social-platforms";

export const runtime = "nodejs";
export const maxDuration = 120;

// Sends the final video and your saved copy to a connected account.
// TikTok: uploads the file. Instagram: gives it a short-lived link to fetch the Reel from.
// Either way the post is "processing" until the platform finishes; the page then polls /api/social/posts/[id].
export const POST = handler(async (req, ctx) => {
  requireGuard();
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { platform?: string; privacy?: string; again?: boolean };
  if (!isPlatform(body.platform)) throw new HttpError("Unknown platform.");
  const platform = body.platform;
  const db = supabase();

  const { data: video } = await db
    .from("videos")
    .select("video_path")
    .eq("scan_id", id)
    .not("video_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const videoPath = video?.video_path as string | undefined;
  if (!videoPath) throw new HttpError("Render the final video first.");

  const { data: copy } = await db.from("social_copy").select("title, description, hashtags").eq("scan_id", id).eq("platform", platform).maybeSingle();
  if (!copy) throw new HttpError("Generate the social copy first.");
  // A public report page gets linked from the caption.
  const { data: scan } = await db.from("scans").select("is_public").eq("id", id).maybeSingle();
  const link = scan?.is_public ? `\n\nFull ingredient breakdown: ${(process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "")}/p/${id}` : "";
  const caption =
    buildCaption({ title: copy.title ?? "", description: copy.description ?? "", hashtags: copy.hashtags ?? [] }, 2200 - link.length) + link;

  // One post per video per platform unless you explicitly post again.
  const { data: existing } = await db
    .from("social_posts")
    .select("id, status")
    .eq("scan_id", id)
    .eq("platform", platform)
    .eq("video_path", videoPath)
    .in("status", ["processing", "published"]);
  if (existing && existing.length > 0 && !body.again) {
    throw new HttpError(
      existing.some((p) => p.status === "published")
        ? "This video is already posted there. Choose 'Post again' to send it anyway."
        : "This video is still being processed by the platform.",
      409,
    );
  }

  const { token, externalId } = await liveToken(platform);
  let remoteId: string;
  let privacy: string | null = null;

  if (platform === "tiktok") {
    privacy = body.privacy ?? "SELF_ONLY";
    if (!(TIKTOK_PRIVACY as readonly string[]).includes(privacy)) throw new HttpError("Unknown privacy setting.");
    const file = await getMedia("videos", videoPath);
    remoteId = (await tiktokPost(token, file, caption, privacy as TikTokPrivacy)).publishId;
  } else {
    if (!externalId) throw new HttpError("Reconnect Instagram (account id missing).");
    // Instagram downloads the file itself, possibly several times, so keep the link alive for 2 hours.
    const url = await mediaUrl("videos", videoPath, 7200);
    remoteId = await instagramCreateReel(token, externalId, url, caption);
  }

  const { data: row, error } = await db
    .from("social_posts")
    .insert({ scan_id: id, platform, video_path: videoPath, remote_id: remoteId, privacy, caption })
    .select("id, status, platform")
    .single();
  if (error) throw new Error(error.message);
  return json(row);
});
