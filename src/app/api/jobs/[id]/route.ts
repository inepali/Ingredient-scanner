import { supabase } from "@/lib/supabase";
import { checkClip } from "@/lib/fal";
import { getMedia, putMedia } from "@/lib/storage";
import type { JobRow } from "@/lib/db-types";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { isRenderStale } from "@/lib/render";

export const runtime = "nodejs";
export const maxDuration = 60;

// Polled by the browser. For a running image-to-video job it asks fal.ai,
// and when the clip is ready it saves it to storage and marks the job done.
export const GET = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();

  const { data } = await db.from("jobs").select("*").eq("id", id).maybeSingle();
  const job = data as JobRow | null;
  if (!job) throw new HttpError("Job not found.", 404);

  // A render whose function was cut off never reports back; stop waiting for it.
  if (job.step === "render" && isRenderStale(job)) {
    const message = "The render stopped responding (the server was probably cut off). Try again.";
    await db.from("jobs").update({ status: "failed", error: message }).eq("id", id).eq("status", "running");
    return json({ status: "failed", error: message });
  }

  if (job.step !== "i2v" || job.status !== "running") {
    return json({ status: job.status, error: job.error, progress: job.step === "render" ? job.output : null });
  }

  const mediaId = job.input?.media_id ?? null;
  const index = job.input?.index ?? 0;

  // Mock jobs finish instantly: the "clip" is a copy of the source photo.
  if (job.external_id?.startsWith("mock-")) {
    const { data: source } = await db
      .from("scan_media")
      .select("storage_path")
      .eq("id", mediaId)
      .maybeSingle();
    if (!source) throw new HttpError("Source photo not found.", 404);
    const photo = await getMedia("images", source.storage_path as string);
    const mockPath = `scans/${job.scan_id}/clips/${job.id}.jpg`;
    await putMedia("videos", mockPath, photo, "image/jpeg");
    await finish(db, job, mockPath, index, mediaId, { mock: true });
    return json({ status: "done" });
  }

  if (!job.status_url || !job.response_url) throw new Error("Job has no fal.ai request to check.");
  const state = await checkClip(job.status_url, job.response_url);

  if (state.state === "running") return json({ status: "running" });

  if (state.state === "failed") {
    await db.from("jobs").update({ status: "failed", error: state.error }).eq("id", id).eq("status", "running");
    return json({ status: "failed", error: state.error });
  }

  const video = await fetch(state.videoUrl);
  if (!video.ok) throw new Error(`Downloading the clip failed (HTTP ${video.status}).`);
  const bytes = Buffer.from(await video.arrayBuffer());

  // Deterministic key; overwriting makes a double-finish harmless.
  const path = `scans/${job.scan_id}/clips/${job.id}.mp4`;
  await putMedia("videos", path, bytes, "video/mp4");

  await finish(db, job, path, index, mediaId, { video_path: path });
  return json({ status: "done" });
});

// Marks the job done exactly once, then records the clip.
async function finish(
  db: ReturnType<typeof supabase>,
  job: JobRow,
  storagePath: string,
  index: number,
  sourceMediaId: string | null,
  output: Record<string, unknown>,
) {
  const { data: claimed } = await db
    .from("jobs")
    .update({ status: "done", output })
    .eq("id", job.id)
    .eq("status", "running")
    .select("id");
  if (!claimed || claimed.length === 0) return; // another poll already finished it

  const { error } = await db.from("scan_media").insert({
    scan_id: job.scan_id,
    kind: "clip",
    storage_path: storagePath,
    sort_order: index,
    source_media_id: sourceMediaId,
  });
  if (error) throw new Error(`Saving clip failed: ${error.message}`);
}

// Cancels a render that is stuck or no longer wanted. The render notices on its next progress write.
export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const { data } = await supabase()
    .from("jobs")
    .update({ status: "failed", error: "Cancelled." })
    .eq("id", id)
    .eq("step", "render")
    .eq("status", "running")
    .select("id");
  return json({ cancelled: (data ?? []).length > 0 });
});
