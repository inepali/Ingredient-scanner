import { encodePng } from "./ring.ts";
import type { OffSummary } from "./openfoodfacts.ts";
import type { Word } from "./captions.ts";

/** Bottom-of-video info bar: NOVA, Nutri-Score and Green-Score as colour chips (only the ones we have, in that order). */
export type BadgeData = Pick<OffSummary, "nutriscore" | "nova" | "green">;

// Kept left of TikTok's like/comment/share buttons (right ~150px) and above its caption area (bottom ~470px).
export const BADGE_TOP = 1310;
export const BADGE_STRIP_H = 150;
const WIDTH = 1080;
const COL_W = 260;
const BAR_H = 130;
const BAR_LEFT = 40;
const GAP = 12;
const CHIP_R = 36;

const LIGHT_TEXT = "#171717";
const NOVA = [["1", "#038141", "Unprocessed"], ["2", "#FECB02", "Ingredient"], ["3", "#EE8100", "Processed"], ["4", "#E63E11", "Ultra-processed"]] as const;
const NUTRI = [["A", "#038141", "Excellent"], ["B", "#85BB2F", "Good"], ["C", "#FECB02", "Average"], ["D", "#EE8100", "Poor"], ["E", "#E63E11", "Bad"]] as const;
const GREEN = [["A+", "#016B37", "Lowest impact"], ["A", "#038141", "Very low impact"], ["B", "#85BB2F", "Low impact"], ["C", "#FECB02", "Moderate impact"], ["D", "#EE8100", "High impact"], ["E", "#E63E11", "Very high impact"]] as const;

export type BadgeCard = {
  /** Which metric this is. */
  key: "nova" | "nutriscore" | "green";
  /** Top edge of the pill. */
  y: number;
  title: string;
  caption: string;
  label: string;
  color: string;
  textColor: string;
  /** Left edge of the column, chip centre and text start, in video pixels. */
  x: number;
  chipX: number;
  chipY: number;
  textX: number;
  textY: number;
  w: number;
};
export type BadgeBar = { x: number; y: number; w: number; h: number; cards: BadgeCard[] };

/** Card geometry for the metrics we know (one separate pill each, left to right); null when there are none. */
export function badgeBar(d: Partial<BadgeData>): BadgeBar | null {
  const picks: [BadgeCard["key"], string, readonly [string, string, string]][] = [];
  if (d.nova) picks.push(["nova", "NOVA", NOVA[d.nova - 1]]);
  if (d.nutriscore) picks.push(["nutriscore", "NUTRI-SCORE", NUTRI["abcde".indexOf(d.nutriscore)]]);
  if (d.green) picks.push(["green", "GREEN-SCORE", GREEN[["a-plus", "a", "b", "c", "d", "e"].indexOf(d.green)]]);
  if (picks.length === 0) return null;
  const x = BAR_LEFT;
  const y = BADGE_TOP + (BADGE_STRIP_H - BAR_H) / 2;
  const cy = y + BAR_H / 2;
  const cards = picks.map(([key, title, [label, color, caption]], i): BadgeCard => {
    const cx0 = x + i * (COL_W + GAP);
    return {
      key,
      title,
      caption,
      label,
      color,
      textColor: color === "#FECB02" ? LIGHT_TEXT : "#FFFFFF",
      x: cx0,
      y,
      chipX: cx0 + 12 + CHIP_R,
      chipY: cy,
      textX: cx0 + 12 + 2 * CHIP_R + 10,
      textY: cy,
      w: COL_W,
    };
  });
  return { x, y, w: picks.length * COL_W + (picks.length - 1) * GAP, h: BAR_H, cards };
}

export const badgeCards = (d: Partial<BadgeData>): BadgeCard[] => badgeBar(d)?.cards ?? [];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

/** Signed-distance antialiased rounded rectangle, composited "over" the buffer. */
function fillRound(buf: Uint8Array, bw: number, bh: number, x: number, y: number, w: number, h: number, r: number, rgb: [number, number, number], alpha: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let py = Math.max(0, Math.floor(y) - 1); py <= Math.min(bh - 1, Math.ceil(y + h) + 1); py++) {
    for (let px = Math.max(0, Math.floor(x) - 1); px <= Math.min(bw - 1, Math.ceil(x + w) + 1); px++) {
      const dx = Math.abs(px + 0.5 - cx) - (w / 2 - r);
      const dy = Math.abs(py + 0.5 - cy) - (h / 2 - r);
      const dist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
      const a = Math.min(1, Math.max(0, 0.5 - dist)) * alpha;
      if (a <= 0) continue;
      const i = (py * bw + px) * 4;
      const dstA = buf[i + 3] / 255;
      const outA = a + dstA * (1 - a);
      for (let k = 0; k < 3; k++) buf[i + k] = Math.round((rgb[k] * a + buf[i + k] * dstA * (1 - a)) / outA);
      buf[i + 3] = Math.round(outA * 255);
    }
  }
}

/** One card as its own transparent PNG (COL_W x BAR_H); place it at (card.x, card.y). */
export function badgeCardPng(card: BadgeCard): Buffer {
  const buf = new Uint8Array(COL_W * BAR_H * 4);
  fillRound(buf, COL_W, BAR_H, 0, 0, COL_W, BAR_H, BAR_H / 2, [12, 12, 12], 0.72);
  const cx = card.chipX - card.x;
  const cy = BAR_H / 2;
  fillRound(buf, COL_W, BAR_H, cx - CHIP_R - 4, cy - CHIP_R - 4, 2 * CHIP_R + 8, 2 * CHIP_R + 8, CHIP_R + 4, [255, 255, 255], 1);
  fillRound(buf, COL_W, BAR_H, cx - CHIP_R, cy - CHIP_R, 2 * CHIP_R, 2 * CHIP_R, CHIP_R, hex(card.color), 1);
  return encodePng(COL_W, BAR_H, buf);
}
export const BADGE_CARD_SIZE = { w: COL_W, h: BAR_H };

const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Seconds when the narrator first names each metric (NOVA, Nutri-Score, Green-Score), so a card can pop in
 * as the voice says it. Metrics never spoken use `fallback`.
 */
export function badgeTimes(d: Partial<BadgeData>, words: Word[], fallback: number): number[] {
  return badgeCards(d).map((c) => {
    let at: number | undefined;
    words.some((w, i) => {
      const t = norm(w.text);
      const next = norm(words[i + 1]?.text ?? "");
      const hit =
        c.key === "nova" ? t === "nova" || t === "novas"
        : c.key === "nutriscore" ? t.startsWith("nutri")
        : t.startsWith("greenscore") || t === "ecoscore" || (t === "green" && next.startsWith("score"));
      if (hit) at = Math.max(0, w.start - 0.15);
      return hit;
    });
    return at ?? fallback;
  });
}

const bgr = (c: string) => {
  const [r, g, b] = hex(c);
  return `&H${[b, g, r].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}&`;
};

/** ASS dialogue lines (chip letter, title, caption). Styles BadgeTitle and BadgeLetter must exist. */
export function badgeDialogues(d: Partial<BadgeData>, starts: string[], end: string): string[] {
  const out: string[] = [];
  badgeCards(d).forEach((c, i) => {
    const start = starts[i];
    const fs = c.label.length > 1 ? 36 : 46;
    out.push(`Dialogue: 2,${start},${end},BadgeLetter,,0,0,0,,{\\an5\\pos(${c.chipX},${c.chipY + 3})\\fs${fs}\\c${bgr(c.textColor)}}${c.label}`);
    out.push(`Dialogue: 2,${start},${end},BadgeTitle,,0,0,0,,{\\an4\\pos(${c.textX},${c.textY - 20})\\fs18\\c&HCCCCCC&}${c.title}`);
    out.push(`Dialogue: 2,${start},${end},BadgeTitle,,0,0,0,,{\\an4\\pos(${c.textX},${c.textY + 10})\\fs${c.caption.length > 14 ? 17 : c.caption.length > 9 ? 20 : 24}\\c&HFFFFFF&}${c.caption}`);
  });
  return out;
}
