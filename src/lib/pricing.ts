// Wan 2.5 image-to-video prices per second of output (fal.ai).
// Pure module so both the server and the browser can show cost estimates.

export type Resolution = "480p" | "720p" | "1080p";

export const PRICE_PER_SECOND: Record<Resolution, number> = {
  "480p": 0.05,
  "720p": 0.1,
  "1080p": 0.15,
};

// Every clip is generated at the shortest length the model offers.
export const CLIP_SECONDS = 5;

export function estimateCostUsd(resolution: Resolution, clips = 1, seconds = CLIP_SECONDS): number {
  return Math.round(PRICE_PER_SECOND[resolution] * seconds * clips * 100) / 100;
}
