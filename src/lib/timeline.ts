// Decides which part of the voiceover each scene covers and which photo/clip
// is on screen. Pure, so it can be unit tested without ffmpeg.

export type PlanScene = { seconds: number; voiceover: string; photo?: number };
export type Segment = { start: number; end: number; photoNumber: number | null };

const MIN_SEGMENT = 0.8;

function countWords(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Scene i starts when its first spoken word starts, so visuals change with
 * the narration. If word timings are missing or don't match the script, scene
 * lengths are scaled to the audio instead.
 */
export function planSegments(
  scenes: PlanScene[],
  words: { start: number; end: number }[],
  total: number,
): Segment[] {
  if (scenes.length === 0 || !(total > 0)) return [];

  const counts = scenes.map((s) => countWords(s.voiceover));
  const sum = counts.reduce((a, b) => a + b, 0);
  const aligned = words.length > 0 && Math.abs(words.length - sum) <= 2;

  const starts: number[] = [];
  if (aligned) {
    let cum = 0;
    scenes.forEach((_, i) => {
      starts.push(i === 0 ? 0 : words[Math.min(cum, words.length - 1)].start);
      cum += counts[i];
    });
  } else {
    const weights = scenes.map((s) => Math.max(1, s.seconds));
    const all = weights.reduce((a, b) => a + b, 0);
    let t = 0;
    weights.forEach((w) => {
      starts.push(t);
      t += (w / all) * total;
    });
  }

  const segments: Segment[] = [];
  scenes.forEach((scene, i) => {
    const start = Math.min(Math.max(starts[i], segments.length ? segments[segments.length - 1].start : 0), total);
    const end = i + 1 < scenes.length ? Math.min(Math.max(starts[i + 1], start), total) : total;
    const photoNumber = scene.photo ?? null;
    if (segments.length > 0 && end - start < MIN_SEGMENT) {
      segments[segments.length - 1].end = end; // too short to show: let the previous scene run on
    } else {
      segments.push({ start, end, photoNumber });
    }
  });
  if (segments.length > 0) segments[segments.length - 1].end = total;
  return segments;
}

export type PhotoRef = {
  number: number; // 1-based, in photo order (matches "photo N" in the script)
  photoPath: string;
  clipPath: string | null;
  clipIsVideo: boolean;
};
export type Source = { kind: "video" | "image"; path: string };

/** Picks the clip (or the still photo) for every segment, rotating when a scene names no photo. */
export function assignSources(segments: Segment[], photos: PhotoRef[]): (Segment & { source: Source })[] {
  if (photos.length === 0) return [];
  let rotate = 0;
  let last = -1;
  return segments.map((seg) => {
    let idx = photos.findIndex((p) => p.number === seg.photoNumber);
    if (idx < 0) {
      idx = rotate % photos.length;
      if (photos.length > 1 && idx === last) idx = (idx + 1) % photos.length;
      rotate = idx + 1;
    }
    last = idx;
    const p = photos[idx];
    const source: Source = p.clipPath
      ? { kind: p.clipIsVideo ? "video" : "image", path: p.clipPath }
      : { kind: "image", path: p.photoPath };
    return { ...seg, source };
  });
}
