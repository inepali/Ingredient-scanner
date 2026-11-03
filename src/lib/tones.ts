// How the video script sounds. Kept separate so the browser can import it without server code.

export const TONES = {
  friendly: {
    label: "Friendly",
    prompt:
      "Warm and curious, like a friend who reads labels at the grocery store and is sharing what they found. Simple everyday words, a little humor, never preachy.",
  },
  straight: {
    label: "Straight talk",
    prompt:
      "Direct and confident. Short punchy sentences, no fluff, no hedging beyond what is accurate. Say what matters and move on.",
  },
  playful: {
    label: "Playful",
    prompt:
      "Upbeat, witty and high energy, with quick punchlines and light puns about the ingredients. Tease the food, never the viewer or any brand.",
  },
  calm: {
    label: "Calm expert",
    prompt:
      "Calm, reassuring and educational, like a friendly dietitian explaining things clearly. Never alarmist; give the reason behind every point.",
  },
} as const;
export type Tone = keyof typeof TONES;
export const DEFAULT_TONE: Tone = "friendly";

export function parseTone(v: unknown): Tone {
  return typeof v === "string" && v in TONES ? (v as Tone) : DEFAULT_TONE;
}
