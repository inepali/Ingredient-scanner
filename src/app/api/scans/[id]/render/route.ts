import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { latestVideo } from "@/lib/queries";
import { RENDER_TIMEOUT_MS } from "@/lib/render";
import { runRender } from "@/lib/render-job";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
// Rendering keeps running after the response (via after()) up to this limit.
export const maxDuration = 300;

// Starts the final 1080x1920 render. The browser polls /api/jobs/[id].
export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();

  const video = await latestVideo(db, id);
  if (!video?.script) throw new HttpError("Create the script first.");
  if (!video.audio_path) throw new HttpError("Generate the voiceover first.");

  const { count } = await db
    .from("scan_media")
    .select("id", { count: "exact", head: true })
    .eq("scan_id", id)
    .eq("kind", "product_image");
  if (!count) throw new HttpError("Add at least one product photo first.");

  // One render at a time; a job stuck past the timeout is written off.
  const cutoff = new Date(Date.now() - RENDER_TIMEOUT_MS).toISOString();
  await db
    .from("jobs")
    .update({ status: "failed", error: "Timed out." })
    .eq("scan_id", id)
    .eq("step", "render")
    .eq("status", "running")
    .lt("created_at", cutoff);
  const { data: active } = await db
    .from("jobs")
    .select("id")
    .eq("scan_id", id)
    .eq("step", "render")
    .eq("status", "running")
    .limit(1);
  if (active && active.length > 0) throw new HttpError("A video is already rendering.", 409);

  const { data: job, error } = await db
    .from("jobs")
    .insert({ scan_id: id, step: "render", status: "running" })
    .select("id")
    .single();
  if (error || !job) throw new Error(`Could not start the render: ${error?.message}`);

  after(() => runRender(id, job.id as string));
  return json({ job_id: job.id as string });
});
