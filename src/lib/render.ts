import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BADGE_TOP } from "./badges.ts";

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
/** Score ring overlay: size and distance from the top (clear of the app UI). */
export const RING_SIZE = 300;
export const RING_TOP = 150;
export const RING_CENTER = { x: WIDTH / 2, y: RING_TOP + RING_SIZE / 2 };

export type RenderSegment = {
  kind: "video" | "image";
  file: string;
  duration: number;
  /** Playback speed for video (0.5 = half speed). Default 1. */
  speed?: number;
  /** "blur": show the whole frame, filling the sides with a blurred copy (nothing cropped). */
  fit?: "fill" | "blur";
};

export type RenderOptions = {
  segments: RenderSegment[];
  audioFile: string;
  assFile: string;
  fontsDir: string;
  outFile: string;
  /** Length of the voiceover; if the video is longer, the audio is padded with silence. */
  audioSeconds?: number;
  /** PNG of the score ring, overlaid top-centre for the whole video. */
  ringFile?: string;
  /** PNG strip with the NOVA / Nutri-Score / Green-Score cards, overlaid at BADGE_TOP. */
  badgesFile?: string;
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
      const speed = seg.speed && seg.speed > 0 ? seg.speed : 1;
      // Slowed footage needs less source than output: speed 0.5 stretches 5 s of source over 10 s.
      args.push("-stream_loop", "-1", "-t", (seg.duration * speed + 0.2).toFixed(3), "-i", seg.file);
      const timing = `${speed !== 1 ? `setpts=(PTS-STARTPTS)/${speed},` : ""}trim=duration=${d},setpts=PTS-STARTPTS`;
      if (seg.fit === "blur") {
        filters.push(
          `[${i}:v]${timing},fps=${FPS},split[bg${i}][fg${i}];` +
            `[bg${i}]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=30:5[bgb${i}];` +
            `[fg${i}]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease[fgs${i}];` +
            `[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v${i}]`,
        );
      } else {
        filters.push(
          `[${i}:v]${timing},` +
            `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},` +
            `fps=${FPS},setsar=1,format=yuv420p[v${i}]`,
        );
      }
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
  if (o.ringFile) args.push("-i", o.ringFile);
  const badgesIdx = n + 1 + (o.ringFile ? 1 : 0);
  if (o.badgesFile) args.push("-i", o.badgesFile);
  const concatIn = o.segments.map((_, i) => `[v${i}]`).join("");
  filters.push(`${concatIn}concat=n=${n}:v=1:a=0[vc]`);
  if (o.ringFile) {
    const x = Math.round((WIDTH - RING_SIZE) / 2);
    filters.push(`[vc][${n + 1}:v]overlay=${x}:${RING_TOP}[vr]`);
  }
  if (o.badgesFile) filters.push(`[${o.ringFile ? "vr" : "vc"}][${badgesIdx}:v]overlay=0:${BADGE_TOP}[vb]`);
  filters.push(`[${o.badgesFile ? "vb" : o.ringFile ? "vr" : "vc"}]ass='${filterPath(o.assFile)}':fontsdir='${filterPath(o.fontsDir)}'[vout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-map", `${n}:a`,
    ...(o.audioSeconds && o.total > o.audioSeconds + 0.05 ? ["-af", `apad=whole_dur=${o.total.toFixed(3)}`] : []),
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

/** True if `p` is an ffmpeg we can run (a real file, or a command found on PATH). */
function works(p: string): boolean {
  if (/[\\/]/.test(p)) return existsSync(p);
  return spawnSync(p, ["-version"], { stdio: "ignore" }).status === 0;
}

let cachedPath: string | null = null;

/**
 * Finds ffmpeg: FFMPEG_PATH, the ffmpeg-static binary, `ffmpeg` on PATH, then
 * the usual install folders. Throws a message that says how to fix it.
 */
export async function ffmpegPath(): Promise<string> {
  if (cachedPath) return cachedPath;

  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null };
    if (mod.default) candidates.push(mod.default);
  } catch {
    // package not installed; try the other places
  }
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  candidates.push(
    join(process.cwd(), "node_modules", "ffmpeg-static", exe),
    "ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  );

  for (const c of candidates) {
    if (works(c)) {
      cachedPath = c;
      return c;
    }
  }
  throw new Error(
    "ffmpeg was not found. Run `npm install` (it installs ffmpeg-static), or install ffmpeg yourself " +
      "(macOS: `brew install ffmpeg`) and restart the server, or set FFMPEG_PATH to its full path.",
  );
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

/** Length in seconds of a media file, read from ffmpeg's banner (ffmpeg-static ships no ffprobe). */
export function parseDuration(banner: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(banner);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export async function probeDuration(file: string, bin?: string): Promise<number | null> {
  const exe = bin ?? (await ffmpegPath());
  const r = spawnSync(exe, ["-hide_banner", "-i", file], { encoding: "utf8" });
  return parseDuration(`${r.stderr ?? ""}${r.stdout ?? ""}`);
}
