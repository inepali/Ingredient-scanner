import type { Alignment } from "./captions.ts";
import { isMock, mockAlignment, silentWav, speechSeconds } from "./mock.ts";

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
    const body = (await res.text()).slice(0, 300);
    if (res.status === 402 && /paid_plan_required|library voices/i.test(body)) {
      throw new Error(
        "That voice is from the ElevenLabs Voice Library, which needs a paid plan. Pick one of the free default voices from the list.",
      );
    }
    const hint = [401, 402, 403].includes(res.status)
      ? " (check the API key and voice id; free plans can block API use)"
      : "";
    throw new Error(`ElevenLabs ${res.status}${hint}: ${body}`);
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

export type Voice = {
  id: string;
  name: string;
  category: string;
  /** Default ("premade") voices work on every plan, including free. */
  free: boolean;
  description: string | null;
};

/** Maps ElevenLabs' /v1/voices response, default voices first. */
export function parseVoices(data: unknown): Voice[] {
  const list = (typeof data === "object" && data !== null ? (data as { voices?: unknown }).voices : null) ?? [];
  const voices: Voice[] = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.voice_id !== "string" || typeof o.name !== "string") continue;
    const category = typeof o.category === "string" ? o.category : "unknown";
    const labels = (typeof o.labels === "object" && o.labels !== null ? o.labels : {}) as Record<string, unknown>;
    const bits = [labels.gender, labels.age, labels.accent, labels.use_case ?? labels.descriptive]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .join(", ");
    voices.push({
      id: o.voice_id,
      name: o.name,
      category,
      free: category === "premade",
      description: bits || null,
    });
  }
  return voices.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
}

/** Voices in your ElevenLabs account. */
export async function listVoices(): Promise<Voice[]> {
  if (isMock()) {
    return [{ id: "mock-voice", name: "Mock voice (silent)", category: "premade", free: true, description: null }];
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseVoices(await res.json());
}
