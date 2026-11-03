// Pure scoring helpers (no framework imports) so they can be unit tested with plain Node.

export type Band = "great" | "good" | "fair" | "poor" | "avoid";

export function bandFor(score: number): Band {
  if (score >= 80) return "great";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "avoid";
}

/**
 * Normalize an ingredient name so label text, model output and reference
 * aliases all compare the same way ("Organic Cane Sugar (3%)" -> "cane sugar").
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(\.\d+)?\s*%/g, " ")
    .replace(/^\s*organic\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ScoredItem = { name: string; score: number };

/**
 * Overall score = position-weighted average (weight 1/position, because labels
 * list ingredients by weight), then caps:
 *  - any ingredient under 20 caps the overall at 60
 *  - partially hydrogenated oil (artificial trans fat) caps it at 30
 * Items must be in label order.
 */
export function overallScore(items: ScoredItem[]): number {
  if (items.length === 0) return 0;

  let weighted = 0;
  let weights = 0;
  items.forEach((item, i) => {
    const w = 1 / (i + 1);
    weighted += item.score * w;
    weights += w;
  });
  return applyCaps(Math.round(weighted / weights), items);
}

/** The safety caps, reusable after the score is blended with outside data. */
export function applyCaps(score: number, items: ScoredItem[]): number {
  let overall = score;
  if (items.some((it) => it.score < 20)) overall = Math.min(overall, 60);
  if (items.some((it) => /partially hydrogenated/.test(it.name.toLowerCase()))) {
    overall = Math.min(overall, 30);
  }
  return Math.max(0, Math.min(100, overall));
}

/** Ring/arc colour per band (the same Tailwind shades the scan page uses). */
export const BAND_HEX: Record<Band, string> = {
  great: "#16a34a",
  good: "#84cc16",
  fair: "#facc15",
  poor: "#f97316",
  avoid: "#dc2626",
};
