import { supabase } from "@/lib/supabase";
import { synthesize } from "@/lib/elevenlabs";
import { wordsFromAlignment } from "@/lib/captions";
import { isMock } from "@/lib/mock";
import { latestVideo } from "@/lib/queries";
import { mediaUrl, putMedia } from "@/lib/storage";
import { narration, parseScript } from "@/lib/script";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Turns the saved script into a voiceover with ElevenLabs (or a silent mock).
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { voice_id?: string };

  const db = supabase();
  const video = await latestVideo(db, id);
  if (!video?.script) throw new HttpError("Create the script first.");

  let text: string;
  try {
    text = narration(parseScript(video.script));
  } catch {
    throw new HttpError("The saved script can't be read. Rewrite it and try again.");
  }

  // Guard against accidentally burning credits on a huge script.
  const maxChars = Number(process.env.MAX_VOICE_CHARS ?? 1800);
  if (text.length > maxChars) {
    throw new HttpError(
      `Script is ${text.length} characters; the limit is ${maxChars}. Shorten it first.`,
    );
  }

  const { data: settings } = await db
    .from("settings")
    .select("default_voice_id")
    .eq("id", 1)
    .maybeSingle();
  const voiceId: string =
    body.voice_id || settings?.default_voice_id || process.env.ELEVENLABS_VOICE_ID || "";
  // A voice picked in the UI becomes the default for next time.
  if (body.voice_id && body.voice_id !== settings?.default_voice_id) {
    await db.from("settings").upsert({ id: 1, default_voice_id: body.voice_id });
  }
  if (!voiceId && !isMock()) {
    throw new HttpError("Set ELEVENLABS_VOICE_ID in .env.local first (any voice id from your ElevenLabs account).");
  }

  const { data: job } = await db
    .from("jobs")
    .insert({ scan_id: id, step: "voice", status: "running" })
    .select("id")
    .single();

  try {
    const speech = await synthesize(text, voiceId);

    const ext = speech.mock ? "wav" : "mp3";
    const path = `scans/${id}/voiceover-${Date.now()}.${ext}`;
    await putMedia("videos", path, speech.audio, speech.mock ? "audio/wav" : "audio/mpeg");

    const words = wordsFromAlignment(speech.alignment);
    const saved = await db
      .from("videos")
      .update({
        voice_id: voiceId || null,
        audio_path: path,
        video_path: null, // a new voiceover makes any earlier final video stale
        duration_s: speech.durationSeconds,
        alignment: speech.alignment,
        words,
      })
      .eq("id", video.id);
    if (saved.error) throw new Error(`Saving voiceover failed: ${saved.error.message}`);

    if (job) {
      await db
        .from("jobs")
        .update({ status: "done", output: { characters: text.length, mock: speech.mock } })
        .eq("id", job.id);
    }

    return json({
      audio_url: await mediaUrl("videos", path),
      duration_s: speech.durationSeconds,
      characters: text.length,
      mock: speech.mock,
      warning:
        speech.durationSeconds > 60
          ? "The voiceover runs over 60 seconds. Shorten the script for TikTok and Reels."
          : null,
    });
  } catch (err) {
    if (job) {
      await db
        .from("jobs")
        .update({ status: "failed", error: err instanceof Error ? err.message : "Voice failed." })
        .eq("id", job.id);
    }
    throw err;
  }
});
