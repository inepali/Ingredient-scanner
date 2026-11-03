import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { deleteMedia } from "@/lib/storage";

export const runtime = "nodejs";

// Removes a video you uploaded (animated clips are replaced by re-animating, not deleted here).
export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();
  const { data: clip } = await db.from("scan_media").select("id, storage_path, source_media_id, kind").eq("id", id).maybeSingle();
  if (!clip || clip.kind !== "clip") throw new HttpError("Video not found.", 404);
  if (clip.source_media_id) throw new HttpError("That's an animated clip, not an upload.", 409);
  await db.from("scan_media").delete().eq("id", id);
  await deleteMedia("videos", clip.storage_path).catch(() => undefined);
  return json({ ok: true });
});
