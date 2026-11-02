import { spawn } from "node:child_process";

// Builds and runs one ffmpeg command: normalizes every segment to 1080x1920 at
// 30 fps (clips loop to fit, stills get a slow zoom), concatenates them, burns
// in the captions and muxes the voiceover.

/**
 * A running render reports a heartbeat every few seconds. If none arrives for
 * this long, the function that was rendering was cut off and the job is dead.
 */
export const RENDER_STALE_MS = 3 * 60 * 1000;

export type RenderProgress = { stage: string; percent: number; heartbeat: string };

/** True when a "running" render has gone quiet for too long. */
export function isRenderStale(
  job: { status: string; created_at: string; output?: Record<string, unknown> | null },
  now = Date.now(),
): boolean {
  if (job.status !== "running") return false;
  const beat = typeof job.output?.heartbeat === "string" ? job.output.heartbeat : job.created_at;
  return now - new Date(beat).getTime() > RENDER_STALE_MS;
}

/** Seconds of output ffmpeg has produced, from a chunk of `-progress` text (or null). */
export function parseProgressSeconds(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]) / 1_000_000;
}

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

export type RenderSegment = { kind: "video" | "image"; file: string; duration: number };

export type RenderOptions = {
  segments: RenderSegment[];
  audioFile: string;
  assFile: string;
  fontsDir: string;
  outFile: string;
  total: number;
  preset?: string;
};

/** Escapes a path for use inside an ffmpeg filter argument. */
function filterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function buildFfmpegArgs(o: RenderOptions): string[] {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  const filters: string[] = [];

  o.segments.forEach((seg, i) => {
    const d = seg.duration.toFixed(3);
    const frames = Math.ceil(seg.duration * FPS) + 2;
    if (seg.kind === "video") {
      args.push("-stream_loop", "-1", "-t", (seg.duration + 0.2).toFixed(3), "-i", seg.file);
      filters.push(
        `[${i}:v]trim=duration=${d},setpts=PTS-STARTPTS,` +
          `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},` +
          `fps=${FPS},setsar=1,format=yuv420p[v${i}]`,
      );
    } else {
      args.push("-i", seg.file);
      // Alternate zoom in / zoom out so consecutive stills don't feel identical.
      const z = i % 2 === 0 ? "min(1+0.0007*on,1.18)" : "max(1.18-0.0007*on,1)";
      filters.push(
        `[${i}:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,` +
          `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
          `trim=duration=${d},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v${i}]`,
      );
    }
  });

  args.push("-i", o.audioFile);
  const n = o.segments.length;
  const concatIn = o.segments.map((_, i) => `[v${i}]`).join("");
  filters.push(`${concatIn}concat=n=${n}:v=1:a=0[vc]`);
  filters.push(`[vc]ass='${filterPath(o.assFile)}':fontsdir='${filterPath(o.fontsDir)}'[vout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-map", `${n}:a`,
    "-c:v", "libx264",
    "-preset", o.preset ?? "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-t", o.total.toFixed(3),
    "-progress", "pipe:1",
    "-nostats",
    o.outFile,
  );
  return args;
}

/** Path to ffmpeg: FFMPEG_PATH, the ffmpeg-static binary, or `ffmpeg` on PATH. */
export async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null };
    if (mod.default) return mod.default;
  } catch {
    // not installed; fall through to PATH
  }
  return "ffmpeg";
}

export async function runFfmpeg(
  args: string[],
  bin?: string,
  onProgress?: (outputSeconds: number) => void,
): Promise<void> {
  const exe = bin ?? (await ffmpegPath());
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d: Buffer) => {
      const seconds = parseProgressSeconds(d.toString());
      if (seconds !== null) onProgress?.(seconds);
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on("error", (e) => reject(new Error(`Could not start ffmpeg (${exe}): ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (exit ${code}): ${err.trim().split("\n").slice(-4).join(" | ")}`)),
    );
  });
}
