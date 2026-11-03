import { supabase } from "@/lib/supabase";
import { latestVideo } from "@/lib/queries";
import type { VoiceoverRow } from "@/lib/db-types";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";

// Makes this take the voiceover the video uses. Only takes made for the current script can be used.
export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();

  const { data } = await db
    .from("voiceovers")
    .select("id, scan_id, video_id, voice_id, audio_path, duration_s, alignment, words")
    .eq("id", id)
    .maybeSingle();
  const take = data as (VoiceoverRow & { alignment: unknown; words: unknown }) | null;
  if (!take) throw new HttpError("Voice take not found.", 404);

  const video = await latestVideo(db, take.scan_id);
  if (!video || video.id !== take.video_id) {
    throw new HttpError("That take was made for an earlier script and doesn't match the current one.", 409);
  }

  const { error } = await db
    .from("videos")
    .update({
      voiceover_id: take.id,
      voice_id: take.voice_id,
      audio_path: take.audio_path,
      duration_s: take.duration_s,
      alignment: take.alignment,
      words: take.words,
      video_path: null, // the final video was made with a different voice
    })
    .eq("id", video.id);
  if (error) throw new Error(`Could not switch voices: ${error.message}`);

  return json({ selected: take.id });
});
