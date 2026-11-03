import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supabase } from "./supabase";
import { getMedia, putMedia } from "./storage";
import { latestVideo } from "./queries";
import { parseScript } from "./script";
import { buildAss } from "./captions";
import { assignSources, planSegments, type PhotoRef } from "./timeline";
import { RING_CENTER, RING_SIZE, buildFfmpegArgs, runFfmpeg, type RenderProgress } from "./render";
import { ringPng } from "./ring";
import { BAND_HEX, bandFor } from "./scoring";
import type { MediaRow } from "./db-types";

const FONT_NAME = "DejaVu Sans";

class Cancelled extends Error {}

/**
 * Builds the final 1080x1920 video for a scan from its script, voiceover and
 * clips/photos and uploads it. Reports stage and percent (plus a heartbeat)
 * through the `jobs` row, which the browser polls. Never throws.
 */
export async function runRender(scanId: string, jobId: string): Promise<void> {
  const db = supabase();
  const dir = await mkdtemp(join(tmpdir(), "render-"));

  let lastWrite = 0;
  // Writes progress at most every 2.5 s unless forced. Returns false if the job was cancelled.
  const report = async (stage: string, percent: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 2500) return;
    lastWrite = now;
    const output: RenderProgress = { stage, percent: Math.max(0, Math.min(99, Math.round(percent))), heartbeat: new Date().toISOString() };
    const { data } = await db.from("jobs").update({ output }).eq("id", jobId).eq("status", "running").select("id");
    if (!data || data.length === 0) throw new Cancelled();
  };

  try {
    await report("Getting started", 1, true);
    const video = await latestVideo(db, scanId);
    if (!video?.script) throw new Error("Create the script first.");
    if (!video.audio_path) throw new Error("Generate the voiceover first.");
    const script = parseScript(video.script);

    const { data: scan } = await db.from("scans").select("overall_score").eq("id", scanId).maybeSingle();

    const { data: mediaData } = await db
      .from("scan_media")
      .select("id, scan_id, kind, storage_path, sort_order, source_media_id")
      .eq("scan_id", scanId)
      .in("kind", ["product_image", "clip"])
      .order("sort_order");
    const media = (mediaData ?? []) as MediaRow[];
    const photos = media.filter((m) => m.kind === "product_image");
    const clips = media.filter((m) => m.kind === "clip");
    // Videos you uploaded yourself (no source photo) join the cut alongside the animated photos.
    const uploads = clips.filter((c) => !c.source_media_id);
    if (photos.length === 0 && uploads.length === 0) throw new Error("Add a product photo or upload a product video first.");

    // Pull everything this render needs into the temp folder (0-10%).
    const refs: PhotoRef[] = [];
    for (const [i, photo] of photos.entries()) {
      await report(`Downloading photos and clips (${i + 1} of ${photos.length})`, 1 + (8 * i) / photos.length, true);
      const photoFile = join(dir, `photo-${i + 1}.jpg`);
      await writeFile(photoFile, await getMedia("images", photo.storage_path));

      const clip = clips.find((c) => c.source_media_id === photo.id);
      let clipFile: string | null = null;
      let clipIsVideo = false;
      if (clip) {
        clipIsVideo = clip.storage_path.endsWith(".mp4");
        clipFile = join(dir, `clip-${i + 1}${clipIsVideo ? ".mp4" : ".jpg"}`);
        await writeFile(clipFile, await getMedia("videos", clip.storage_path));
      }
      // With your own footage, plain still photos are left out; animated clips still count.
      if (uploads.length > 0 && !clipFile) continue;
      refs.push({ number: i + 1, photoPath: photoFile, clipPath: clipFile, clipIsVideo });
    }
    for (const [k, up] of uploads.entries()) {
      await report(`Downloading your videos (${k + 1} of ${uploads.length})`, 9, true);
      const ext = (/\.(mp4|mov|webm|m4v)$/i.exec(up.storage_path)?.[1] ?? "mp4").toLowerCase();
      const file = join(dir, `upload-${k + 1}.${ext}`);
      await writeFile(file, await getMedia("videos", up.storage_path));
      refs.push({ number: photos.length + k + 1, photoPath: file, clipPath: file, clipIsVideo: true });
    }
    const audioFile = join(dir, video.audio_path.endsWith(".wav") ? "voice.wav" : "voice.mp3");
    await writeFile(audioFile, await getMedia("videos", video.audio_path));

    const words = video.words ?? [];
    const total = video.duration_s ?? words[words.length - 1]?.end ?? 0;
    if (!(total > 0)) throw new Error("The voiceover has no length. Regenerate the voice.");

    const segments = assignSources(planSegments(script.scenes, words, total), refs);
    if (segments.length === 0) throw new Error("Nothing to put on screen.");

    const assFile = join(dir, "captions.ass");
    await writeFile(
      assFile,
      buildAss({
        words,
        duration: total,
        fontName: FONT_NAME,
        score: scan?.overall_score ?? null,
        ringCenter: RING_CENTER,
      }),
    );
    let ringFile: string | undefined;
    if (scan?.overall_score != null) {
      ringFile = join(dir, "ring.png");
      await writeFile(ringFile, ringPng(RING_SIZE, scan.overall_score, BAND_HEX[bandFor(scan.overall_score)]));
    }

    // Encode (10-90%): ffmpeg reports how many seconds of video it has written.
    await report("Rendering video", 10, true);
    const outFile = join(dir, "final.mp4");
    let progressError: unknown = null;
    await runFfmpeg(
      buildFfmpegArgs({
        segments: segments.map((s) => ({ kind: s.source.kind, file: s.source.path, duration: s.end - s.start })),
        audioFile,
        assFile,
        fontsDir: process.env.FONTS_DIR ?? join(process.cwd(), "assets", "fonts"),
        outFile,
        ringFile,
        total,
        preset: process.env.RENDER_PRESET || "veryfast",
      }),
      undefined,
      (seconds) => {
        report("Rendering video", 10 + 80 * Math.min(1, seconds / total)).catch((e) => {
          progressError = e;
        });
      },
    );
    if (progressError instanceof Cancelled) throw progressError;

    await report("Uploading", 92, true);
    const key = `scans/${scanId}/final-${Date.now()}.mp4`;
    await putMedia("videos", key, await readFile(outFile), "video/mp4");
    const saved = await db.from("videos").update({ video_path: key }).eq("id", video.id);
    if (saved.error) throw new Error(`Saving the video failed: ${saved.error.message}`);

    await db
      .from("jobs")
      .update({ status: "done", output: { stage: "Done", percent: 100, heartbeat: new Date().toISOString(), video_path: key, seconds: Math.round(total) } })
      .eq("id", jobId)
      .eq("status", "running");
  } catch (err) {
    if (err instanceof Cancelled) return; // the job row already says "failed: Cancelled"
    console.error("Render failed:", err);
    await db
      .from("jobs")
      .update({ status: "failed", error: err instanceof Error ? err.message : "Render failed." })
      .eq("id", jobId)
      .eq("status", "running");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
