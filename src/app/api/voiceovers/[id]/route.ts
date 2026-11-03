import { supabase } from "@/lib/supabase";
import { deleteMedia } from "@/lib/storage";
import type { VoiceoverRow } from "@/lib/db-types";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";

// Deletes a voice take and its audio file. The take in use can't be deleted.
export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();

  const { data } = await db.from("voiceovers").select("id, audio_path").eq("id", id).maybeSingle();
  const take = data as Pick<VoiceoverRow, "id" | "audio_path"> | null;
  if (!take) throw new HttpError("Voice take not found.", 404);

  const { data: inUse } = await db.from("videos").select("id").eq("voiceover_id", id).limit(1);
  if (inUse && inUse.length > 0) {
    throw new HttpError("This take is in use. Select another one first.", 409);
  }

  const removed = await db.from("voiceovers").delete().eq("id", id);
  if (removed.error) throw new Error(`Delete failed: ${removed.error.message}`);
  await deleteMedia("videos", take.audio_path).catch(() => {}); // a missing file isn't a problem
  return json({ deleted: id });
});
