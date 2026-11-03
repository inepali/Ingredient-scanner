import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoRow } from "./db-types";

/** The scan's current video row (script, voiceover), or null. */
export async function latestVideo(db: SupabaseClient, scanId: string): Promise<VideoRow | null> {
  const { data, error } = await db
    .from("videos")
    .select("id, scan_id, script, voice_id, audio_path, voiceover_id, video_path, duration_s, words, version")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load video: ${error.message}`);
  return (data as VideoRow | null) ?? null;
}
