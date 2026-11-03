// Delivery presets: the same voice and script, performed differently. These map
// to ElevenLabs voice settings. Kept separate so the browser can import it.

export const DELIVERIES = {
  natural: {
    label: "Natural",
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
  },
  expressive: {
    label: "Expressive",
    settings: { stability: 0.3, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true },
  },
  steady: {
    label: "Steady",
    settings: { stability: 0.8, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
  },
} as const;
export type Delivery = keyof typeof DELIVERIES;
export const DEFAULT_DELIVERY: Delivery = "natural";

export function parseDelivery(v: unknown): Delivery {
  return typeof v === "string" && v in DELIVERIES ? (v as Delivery) : DEFAULT_DELIVERY;
}
