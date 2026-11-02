import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supabase } from "./supabase";
import { getMedia, putMedia } from "./storage";
import { latestVideo } from "./queries";
import { parseScript } from "./script";
import { buildAss } from "./captions";
import { assignSources, planSegments, type PhotoRef } from "./timeline";
import { buildFfmpegArgs, runFfmpeg } from "./render";
import { writeSocialCopy } from "./social";
import type { MediaRow } from "./db-types";

const FONT_NAME = "DejaVu Sans";

/**
 * Builds the final 1080x1920 video for a scan from its script, voiceover and
 * clips/photos, uploads it, then writes the post copy. Reports through the
 * `jobs` row (the browser polls it) and never throws.
 */
export async function runRender(scanId: string, jobId: string): Promise<void> {
  const db = supabase();
  const dir = await mkdtemp(join(tmpdir(), "render-"));
  const fail = async (message: string) => {
    await db.from("jobs").update({ status: "failed", error: message }).eq("id", jobId);
  };

  try {
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
    if (photos.length === 0) throw new Error("Add at least one product photo first.");

    // Pull everything this render needs into the temp folder.
    const refs: PhotoRef[] = [];
    for (const [i, photo] of photos.entries()) {
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
      refs.push({ number: i + 1, photoPath: photoFile, clipPath: clipFile, clipIsVideo });
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
        scoreLabel: scan?.overall_score != null ? `Score ${scan.overall_score}/100` : null,
      }),
    );

    const outFile = join(dir, "final.mp4");
    await runFfmpeg(
      buildFfmpegArgs({
        segments: segments.map((s) => ({ kind: s.source.kind, file: s.source.path, duration: s.end - s.start })),
        audioFile,
        assFile,
        fontsDir: process.env.FONTS_DIR ?? join(process.cwd(), "assets", "fonts"),
        outFile,
        total,
        preset: process.env.RENDER_PRESET || "veryfast",
      }),
    );

    const key = `scans/${scanId}/final-${Date.now()}.mp4`;
    await putMedia("videos", key, await readFile(outFile), "video/mp4");
    const saved = await db.from("videos").update({ video_path: key }).eq("id", video.id);
    if (saved.error) throw new Error(`Saving the video failed: ${saved.error.message}`);

    // Title, description and hashtags. A failure here must not lose the video.
    let copyError: string | null = null;
    try {
      await writeSocialCopy(db, scanId);
    } catch (err) {
      copyError = err instanceof Error ? err.message : "Post copy failed.";
    }

    await db
      .from("jobs")
      .update({ status: "done", output: { video_path: key, seconds: Math.round(total), copy_error: copyError } })
      .eq("id", jobId);
  } catch (err) {
    console.error("Render failed:", err);
    await fail(err instanceof Error ? err.message : "Render failed.");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
