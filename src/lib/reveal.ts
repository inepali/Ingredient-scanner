// When the score ring and the NOVA / Nutri-Score / Green-Score badges appear in the video.
// Holding them back keeps people watching: the verdict is the payoff, not the headline.

export type RevealChoice = "start" | "10" | "15" | "25" | "end";
export const REVEAL_CHOICES: { id: RevealChoice; label: string }[] = [
  { id: "start", label: "Right away" },
  { id: "10", label: "After 10 seconds" },
  { id: "15", label: "After 15 seconds (recommended)" },
  { id: "25", label: "After 25 seconds" },
  { id: "end", label: "At the end (last 10 seconds)" },
];
export const DEFAULT_REVEAL: RevealChoice = "15";

export function parseReveal(v: unknown): RevealChoice {
  return REVEAL_CHOICES.find((c) => c.id === v)?.id ?? DEFAULT_REVEAL;
}

/** Seconds into the video when the score appears. Always leaves at least 4 s on screen. */
export function revealSeconds(choice: RevealChoice, total: number): number {
  if (!(total > 0) || choice === "start") return 0;
  const wanted = choice === "end" ? total - 10 : Number(choice);
  return Math.max(0, Math.min(wanted, total - 4));
}
