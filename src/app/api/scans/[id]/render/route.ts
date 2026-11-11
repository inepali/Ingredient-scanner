import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { latestVideo } from "@/lib/queries";
import { ffmpegPath, isRenderStale } from "@/lib/render";
import type { JobRow } from "@/lib/db-types";
import { runRender } from "@/lib/render-job";
import { DEFAULT_REVEAL, parseReveal } from "@/lib/reveal";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
// Rendering keeps running after the response (via after()) up to this limit.
export const maxDuration = 300;

// Starts the final 1080x1920 render. The browser polls /api/jobs/[id].
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();
  const body = (await req.json().catch(() => ({}))) as { reveal?: unknown };
  // When the score and badges appear: the choice from the button, remembered for next time.
  let reveal = DEFAULT_REVEAL;
  if (body.reveal !== undefined) {
    reveal = parseReveal(body.reveal);
    await db.from("settings").upsert({ id: 1, score_reveal: reveal });
  } else {
    const { data: st } = await db.from("settings").select("score_reveal").eq("id", 1).maybeSingle();
    reveal = parseReveal(st?.score_reveal);
  }

  await ffmpegPath(); // fail now with a clear message instead of inside the background job

  const video = await latestVideo(db, id);
  if (!video?.script) throw new HttpError("Create the script first.");
  if (!video.audio_path) throw new HttpError("Generate the voiceover first.");

  // Needs something to show: a product photo, or a video you uploaded.
  const { data: visuals } = await db
    .from("scan_media")
    .select("kind, source_media_id")
    .eq("scan_id", id)
    .in("kind", ["product_image", "clip"]);
  const hasVisual = (visuals ?? []).some((m) => m.kind === "product_image" || !m.source_media_id);
  if (!hasVisual) throw new HttpError("Add a product photo or upload a product video first.");

  // One render at a time; a job that stopped sending heartbeats is written off.
  const { data: running } = await db
    .from("jobs")
    .select("id, status, created_at, output")
    .eq("scan_id", id)
    .eq("step", "render")
    .eq("status", "running");
  let active = false;
  for (const j of (running ?? []) as Pick<JobRow, "id" | "status" | "created_at" | "output">[]) {
    if (isRenderStale(j)) {
      await db.from("jobs").update({ status: "failed", error: "Timed out." }).eq("id", j.id).eq("status", "running");
    } else {
      active = true;
    }
  }
  if (active) throw new HttpError("A video is already rendering.", 409);

  const { data: job, error } = await db
    .from("jobs")
    .insert({ scan_id: id, step: "render", status: "running" })
    .select("id")
    .single();
  if (error || !job) throw new Error(`Could not start the render: ${error?.message}`);

  after(() => runRender(id, job.id as string, reveal));
  return json({ job_id: job.id as string });
});
