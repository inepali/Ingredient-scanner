import { supabase } from "@/lib/supabase";
import { submitClip, motionPrompt } from "@/lib/fal";
import { isMock } from "@/lib/mock";
import { estimateCostUsd, type Resolution } from "@/lib/pricing";
import { mediaUrl } from "@/lib/storage";
import { latestVideo } from "@/lib/queries";
import { parseScript } from "@/lib/script";
import type { JobRow, MediaRow } from "@/lib/db-types";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Only draft and final quality are offered; 1080p costs 3x the draft rate.
const RESOLUTIONS: Resolution[] = ["480p", "720p"];

// Starts Wan 2.5 image-to-video jobs for product photos that have no clip yet.
// Generation takes minutes, so this only submits; /api/jobs/[id] finishes them.
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { resolution?: string };

  const requested = body.resolution ?? process.env.WAN_RESOLUTION ?? "480p";
  if (!RESOLUTIONS.includes(requested as Resolution)) {
    throw new HttpError("Resolution must be 480p (draft) or 720p (final).");
  }
  const resolution = requested as Resolution;
  const maxClips = Number(process.env.MAX_CLIPS ?? 4);

  const db = supabase();

  const { data: mediaData } = await db
    .from("scan_media")
    .select("id, scan_id, kind, storage_path, sort_order, source_media_id")
    .eq("scan_id", id)
    .in("kind", ["product_image", "clip"])
    .order("sort_order");
  const media = (mediaData ?? []) as MediaRow[];
  const photos = media.filter((m) => m.kind === "product_image");
  const clips = media.filter((m) => m.kind === "clip");
  if (photos.length === 0) throw new HttpError("Add at least one product photo first.");

  const { data: runningData } = await db
    .from("jobs")
    .select("id, input")
    .eq("scan_id", id)
    .eq("step", "i2v")
    .eq("status", "running");
  const running = (runningData ?? []) as Pick<JobRow, "id" | "input">[];

  // Skip photos that already have a clip or an in-flight job.
  const covered = new Set<string>([
    ...clips.map((c) => c.source_media_id ?? ""),
    ...running.map((j) => j.input?.media_id ?? ""),
  ]);
  const todo = photos.filter((p) => !covered.has(p.id));

  const slots = Math.max(0, maxClips - clips.length - running.length);
  const batch = todo.slice(0, slots);
  if (batch.length === 0) {
    throw new HttpError(
      todo.length === 0
        ? "Every photo already has a clip."
        : `Clip limit reached (${maxClips} per scan). Raise MAX_CLIPS to allow more.`,
    );
  }

  // Scene visuals from the script make better motion prompts than the generic ones.
  const video = await latestVideo(db, id);
  let visuals: string[] = [];
  if (video?.script) {
    try {
      visuals = parseScript(video.script).scenes.map((s) => s.visual);
    } catch {
      // fall back to the generic prompts
    }
  }
  const cost = estimateCostUsd(resolution, 1);
  const created: { job_id: string; media_id: string }[] = [];

  for (const [i, photo] of batch.entries()) {
    const index = clips.length + running.length + i;
    const prompt = visuals[index % Math.max(visuals.length, 1)] ?? motionPrompt(index);

    let externalId: string;
    let statusUrl: string | null = null;
    let responseUrl: string | null = null;
    if (isMock()) {
      externalId = `mock-${crypto.randomUUID()}`;
    } else {
      const imageUrl = await mediaUrl("images", photo.storage_path);
      const submitted = await submitClip({ imageUrl, prompt, resolution });
      externalId = submitted.requestId;
      statusUrl = submitted.statusUrl;
      responseUrl = submitted.responseUrl;
    }

    const { data: job, error } = await db
      .from("jobs")
      .insert({
        scan_id: id,
        step: "i2v",
        status: "running",
        cost_usd: isMock() ? 0 : cost,
        external_id: externalId,
        status_url: statusUrl,
        response_url: responseUrl,
        input: { media_id: photo.id, prompt, resolution, index },
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`Saving job failed: ${error?.message}`);
    created.push({ job_id: job.id as string, media_id: photo.id });
  }

  return json({
    jobs: created,
    estimated_cost_usd: isMock() ? 0 : estimateCostUsd(resolution, created.length),
    resolution,
    mock: isMock(),
  });
});
