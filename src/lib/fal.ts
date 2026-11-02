// Wan 2.5 image-to-video on fal.ai, via the REST queue (no SDK needed).
// Generation takes minutes, so we submit, then poll from /api/jobs/[id].
import { CLIP_SECONDS, type Resolution } from "./pricing";

const MODEL = process.env.FAL_I2V_MODEL ?? "fal-ai/wan-25-preview/image-to-video";

const NEGATIVE =
  "blurry, distorted packaging, warped or unreadable text, extra objects, people, watermark";

const MOVES = [
  "Slow smooth camera push-in",
  "Gentle camera drift from left to right",
  "Slow camera tilt up with a slight orbit",
  "Slow smooth camera pull-back",
];

export function motionPrompt(index: number): string {
  return `${MOVES[index % MOVES.length]} on the food product. Soft natural lighting, the product stays sharp and in frame, packaging text unchanged.`;
}

function headers() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return { Authorization: `Key ${key}`, "content-type": "application/json" };
}

export async function submitClip(input: {
  imageUrl: string;
  prompt: string;
  resolution: Resolution;
}): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
  const res = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: input.prompt,
      image_url: input.imageUrl,
      resolution: input.resolution,
      duration: String(CLIP_SECONDS),
      negative_prompt: NEGATIVE,
      enable_prompt_expansion: false,
    }),
  });
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as {
    request_id?: string;
    status_url?: string;
    response_url?: string;
  };
  if (!data.request_id || !data.status_url || !data.response_url) {
    throw new Error("fal.ai returned an unexpected response.");
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

export type ClipState =
  | { state: "running" }
  | { state: "done"; videoUrl: string }
  | { state: "failed"; error: string };

export async function checkClip(statusUrl: string, responseUrl: string): Promise<ClipState> {
  const res = await fetch(statusUrl, { headers: headers() });
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`fal.ai status ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const status = (await res.json()) as { status?: string; error?: string; error_type?: string };
  if (status.status !== "COMPLETED") return { state: "running" };
  // Failed and cancelled requests also report COMPLETED, with an error field.
  if (status.error) return { state: "failed", error: `${status.error_type ?? "error"}: ${status.error}` };

  const out = await fetch(responseUrl, { headers: headers() });
  if (!out.ok) {
    return { state: "failed", error: `fal.ai result ${out.status}: ${(await out.text()).slice(0, 300)}` };
  }
  const result = (await out.json()) as { video?: { url?: string } };
  const url = result.video?.url;
  return url
    ? { state: "done", videoUrl: url }
    : { state: "failed", error: "fal.ai finished without a video URL." };
}
