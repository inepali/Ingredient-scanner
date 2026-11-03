import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
import { deleteMedia, type MediaBucket } from "./storage";

const BUSY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Deletes a scan, its database rows (everything cascades) and its files in
 * storage. Refuses while a clip or render job started in the last 10 minutes is
 * still running, since that work would fail halfway.
 */
export async function deleteScan(db: SupabaseClient, id: string): Promise<{ files: number }> {
  const { data: scan } = await db.from("scans").select("id").eq("id", id).maybeSingle();
  if (!scan) throw new HttpError("Scan not found.", 404);

  const { data: running } = await db.from("jobs").select("created_at").eq("scan_id", id).eq("status", "running");
  if ((running ?? []).some((j) => Date.now() - new Date(j.created_at as string).getTime() < BUSY_WINDOW_MS)) {
    throw new HttpError("Something is still rendering for this scan. Wait for it to finish (or cancel it), then delete.", 409);
  }

  const files = new Map<string, { bucket: MediaBucket; key: string }>();
  const add = (bucket: MediaBucket, key: unknown) => {
    if (typeof key === "string" && key) files.set(`${bucket}/${key}`, { bucket, key });
  };

  const { data: media } = await db.from("scan_media").select("kind, storage_path").eq("scan_id", id);
  for (const m of media ?? []) add(m.kind === "clip" ? "videos" : "images", m.storage_path);
  const { data: videos } = await db.from("videos").select("audio_path, video_path").eq("scan_id", id);
  for (const v of videos ?? []) {
    add("videos", v.audio_path);
    add("videos", v.video_path);
  }
  const { data: takes } = await db.from("voiceovers").select("audio_path").eq("scan_id", id);
  for (const t of takes ?? []) add("videos", t.audio_path);
  const { data: posts } = await db.from("social_posts").select("video_path").eq("scan_id", id);
  for (const p of posts ?? []) add("videos", p.video_path);

  // Rows first: a leftover file is harmless, a row pointing at a missing file is not.
  const { error } = await db.from("scans").delete().eq("id", id);
  if (error) throw new Error(`Could not delete the scan: ${error.message}`);

  const list = [...files.values()];
  await Promise.allSettled(list.map((f) => deleteMedia(f.bucket, f.key)));
  return { files: list.length };
}
