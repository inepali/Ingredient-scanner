import { supabase } from "@/lib/supabase";
import { NotReadyError, writeSocialCopy } from "@/lib/social";
import { normalizeHashtags } from "@/lib/copy";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Rewrites the TikTok and Instagram title, description and hashtags.
export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  try {
    return json(await writeSocialCopy(supabase(), id));
  } catch (err) {
    if (err instanceof NotReadyError) throw new HttpError(err.message, err.message.startsWith("Scan not") ? 404 : 400);
    throw err;
  }
});

// Saves your edits to one platform's title, description and hashtags.
export const PATCH = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    title?: unknown;
    description?: unknown;
    hashtags?: unknown;
  };
  if (body.platform !== "tiktok" && body.platform !== "instagram") throw new HttpError("Unknown platform.");

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title) throw new HttpError("The title can't be empty.");
  if (title.length > 150) throw new HttpError("Title is too long (max 150 characters).");
  if (description.length > 2200) throw new HttpError("Description is too long (max 2200 characters).");
  const hashtags = normalizeHashtags(body.hashtags).slice(0, 30);

  const { data, error } = await supabase()
    .from("social_copy")
    .update({ title, description, hashtags })
    .eq("scan_id", id)
    .eq("platform", body.platform)
    .select("platform");
  if (error) throw new Error(`Saving failed: ${error.message}`);
  if (!data || data.length === 0) throw new HttpError("Generate the social copy first.", 404);
  return json({ title, description, hashtags });
});
