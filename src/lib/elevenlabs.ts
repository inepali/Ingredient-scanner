import type { Alignment } from "./captions";
import { isMock, mockAlignment, silentWav, speechSeconds } from "./mock";

const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";

export type Speech = {
  audio: Buffer;
  alignment: Alignment;
  durationSeconds: number;
  mock: boolean;
};

/** Text to speech with character timings (used later for captions). */
export async function synthesize(text: string, voiceId: string): Promise<Speech> {
  if (isMock()) {
    const seconds = speechSeconds(text);
    return {
      audio: silentWav(seconds),
      alignment: mockAlignment(text, seconds),
      durationSeconds: seconds,
      mock: true,
    };
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL }),
    },
  );
  if (!res.ok) {
    const hint = [401, 402, 403].includes(res.status)
      ? " (check the API key and voice id; free plans can block API use)"
      : "";
    throw new Error(`ElevenLabs ${res.status}${hint}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { audio_base64?: string; alignment?: Alignment | null };
  if (!data.audio_base64) throw new Error("ElevenLabs returned no audio.");

  const audio = Buffer.from(data.audio_base64, "base64");
  // If timings are missing, fall back to evenly spaced estimates.
  const alignment = data.alignment ?? mockAlignment(text, speechSeconds(text));
  const ends = alignment.character_end_times_seconds;
  const durationSeconds = ends.length ? ends[ends.length - 1] : speechSeconds(text);

  return { audio, alignment, durationSeconds, mock: false };
}
