// MOCK_AI=true swaps the paid services (ElevenLabs, fal.ai) for free stand-ins
// so the whole flow can be tested without spending anything.
import type { Alignment } from "./captions.ts";

export function isMock(): boolean {
  return process.env.MOCK_AI === "true";
}

/** Rough speaking time: about 2.5 words per second. */
export function speechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, words / 2.5);
}

/** A valid 16-bit mono 8 kHz WAV file of silence. */
export function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2); // zero-filled = silence
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/** Evenly spaced character timings, used for mock audio and as a fallback. */
export function mockAlignment(text: string, seconds: number): Alignment {
  const chars = [...text];
  const per = seconds / Math.max(1, chars.length);
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * per),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * per),
  };
}
