import { encodePng } from "./ring.ts";
import type { OffSummary } from "./openfoodfacts.ts";

/** Bottom-of-video info bar: NOVA, Nutri-Score and Green-Score as colour chips (only the ones we have, in that order). */
export type BadgeData = Pick<OffSummary, "nutriscore" | "nova" | "green">;

// Kept left of TikTok's like/comment/share buttons (right ~150px) and above its caption area (bottom ~470px).
export const BADGE_TOP = 1310;
export const BADGE_STRIP_H = 150;
const WIDTH = 1080;
const COL_W = 260;
const BAR_H = 130;
const BAR_LEFT = 40;
const BAR_PAD = 14;
const CHIP_R = 36;

const LIGHT_TEXT = "#171717";
const NOVA = [["1", "#038141", "Unprocessed"], ["2", "#FECB02", "Ingredient"], ["3", "#EE8100", "Processed"], ["4", "#E63E11", "Ultra-processed"]] as const;
const NUTRI = [["A", "#038141", "Excellent"], ["B", "#85BB2F", "Good"], ["C", "#FECB02", "Average"], ["D", "#EE8100", "Poor"], ["E", "#E63E11", "Bad"]] as const;
const GREEN = [["A+", "#016B37", "Lowest impact"], ["A", "#038141", "Very low impact"], ["B", "#85BB2F", "Low impact"], ["C", "#FECB02", "Moderate impact"], ["D", "#EE8100", "High impact"], ["E", "#E63E11", "Very high impact"]] as const;

export type BadgeCard = {
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

/** Bar geometry for the metrics we know; null when there are none. */
export function badgeBar(d: Partial<BadgeData>): BadgeBar | null {
  const picks: [string, readonly [string, string, string]][] = [];
  if (d.nova) picks.push(["NOVA", NOVA[d.nova - 1]]);
  if (d.nutriscore) picks.push(["NUTRI-SCORE", NUTRI["abcde".indexOf(d.nutriscore)]]);
  if (d.green) picks.push(["GREEN-SCORE", GREEN[["a-plus", "a", "b", "c", "d", "e"].indexOf(d.green)]]);
  if (picks.length === 0) return null;
  const w = picks.length * COL_W + 2 * BAR_PAD;
  const x = BAR_LEFT;
  const y = BADGE_TOP + (BADGE_STRIP_H - BAR_H) / 2;
  const cy = y + BAR_H / 2;
  const cards = picks.map(([title, [label, color, caption]], i): BadgeCard => {
    const cx0 = x + BAR_PAD + i * COL_W;
    return {
      title,
      caption,
      label,
      color,
      textColor: color === "#FECB02" ? LIGHT_TEXT : "#FFFFFF",
      x: cx0,
      chipX: cx0 + 12 + CHIP_R,
      chipY: cy,
      textX: cx0 + 12 + 2 * CHIP_R + 10,
      textY: cy,
      w: COL_W,
    };
  });
  return { x, y, w, h: BAR_H, cards };
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

/** Full-width transparent strip (1080 x BADGE_STRIP_H) to overlay at y = BADGE_TOP. Null when there is nothing to show. */
export function badgesPng(d: Partial<BadgeData>): Buffer | null {
  const bar = badgeBar(d);
  if (!bar) return null;
  const buf = new Uint8Array(WIDTH * BADGE_STRIP_H * 4);
  fillRound(buf, WIDTH, BADGE_STRIP_H, bar.x, bar.y - BADGE_TOP, bar.w, bar.h, bar.h / 2, [12, 12, 12], 0.68);
  bar.cards.forEach((c, i) => {
    if (i > 0) fillRound(buf, WIDTH, BADGE_STRIP_H, c.x - 1, bar.y - BADGE_TOP + 34, 2, bar.h - 68, 1, [255, 255, 255], 0.22);
    const cy = c.chipY - BADGE_TOP;
    fillRound(buf, WIDTH, BADGE_STRIP_H, c.chipX - CHIP_R - 4, cy - CHIP_R - 4, 2 * CHIP_R + 8, 2 * CHIP_R + 8, CHIP_R + 4, [255, 255, 255], 1);
    fillRound(buf, WIDTH, BADGE_STRIP_H, c.chipX - CHIP_R, cy - CHIP_R, 2 * CHIP_R, 2 * CHIP_R, CHIP_R, hex(c.color), 1);
  });
  return encodePng(WIDTH, BADGE_STRIP_H, buf);
}

const bgr = (c: string) => {
  const [r, g, b] = hex(c);
  return `&H${[b, g, r].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}&`;
};

/** ASS dialogue lines (chip letter, title, caption). Styles BadgeTitle and BadgeLetter must exist. */
export function badgeDialogues(d: Partial<BadgeData>, start: string, end: string): string[] {
  const out: string[] = [];
  for (const c of badgeCards(d)) {
    const fs = c.label.length > 1 ? 36 : 46;
    out.push(`Dialogue: 2,${start},${end},BadgeLetter,,0,0,0,,{\\an5\\pos(${c.chipX},${c.chipY + 3})\\fs${fs}\\c${bgr(c.textColor)}}${c.label}`);
    out.push(`Dialogue: 2,${start},${end},BadgeTitle,,0,0,0,,{\\an4\\pos(${c.textX},${c.textY - 20})\\fs18\\c&HCCCCCC&}${c.title}`);
    out.push(`Dialogue: 2,${start},${end},BadgeTitle,,0,0,0,,{\\an4\\pos(${c.textX},${c.textY + 10})\\fs${c.caption.length > 14 ? 17 : c.caption.length > 9 ? 20 : 24}\\c&HFFFFFF&}${c.caption}`);
  }
  return out;
}
