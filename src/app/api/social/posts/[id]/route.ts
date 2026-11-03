import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { liveToken, requireGuard } from "@/lib/social-accounts";
import { instagramAdvance, tiktokStatus, type PostState } from "@/lib/social-platforms";

export const runtime = "nodejs";
export const maxDuration = 60;

// Asks the platform how a post is going (and, for Instagram, publishes it once it's ready).
export const POST = handler(async (_req, ctx) => {
  requireGuard();
  const id = await paramId(ctx);
  const db = supabase();
  const { data: post } = await db.from("social_posts").select("*").eq("id", id).maybeSingle();
  if (!post) throw new HttpError("Post not found.", 404);
  if (post.status !== "processing") return json({ id, status: post.status, permalink: post.permalink, error: post.error });

  let state: PostState;
  try {
    const { token, externalId } = await liveToken(post.platform);
    if (post.platform === "tiktok") state = await tiktokStatus(token, post.remote_id);
    else {
      if (!externalId) throw new Error("Reconnect Instagram (account id missing).");
      state = await instagramAdvance(token, externalId, post.remote_id);
    }
  } catch (err) {
    // A failed check isn't a failed post; report it and let the page try again.
    return json({ id, status: "processing", note: err instanceof Error ? err.message : "Could not check status." });
  }

  if (state.status !== "processing") {
    await db
      .from("social_posts")
      .update({
        status: state.status,
        permalink: state.permalink ?? null,
        error: state.status === "failed" ? (state.detail ?? "Failed.") : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }
  return json({ id, status: state.status, detail: state.detail, permalink: state.permalink, error: state.status === "failed" ? state.detail : null });
});
