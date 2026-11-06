import { encodePng } from "./ring.ts";
import type { OffSummary } from "./openfoodfacts.ts";

/** Bottom-of-video badges: NOVA (left), Nutri-Score (centre), Green-Score (right). Only the ones we have. */
export type BadgeData = Pick<OffSummary, "nutriscore" | "nova" | "green">;

export const BADGE_TOP = 1480;
export const BADGE_STRIP_H = 170;
const WIDTH = 1080;
const CARD_W = 310;
const CARD_H = 150;
const CARD_GAP = 20;
const CARD_X0 = (WIDTH - (3 * CARD_W + 2 * CARD_GAP)) / 2;
const CARD_Y = BADGE_TOP + 10;
const PAD = 14;
const STEP_GAP = 6;
const ROW_CENTER = CARD_Y + 98;

const NUTRI = [["A", "#038141"], ["B", "#85BB2F"], ["C", "#FECB02"], ["D", "#EE8100"], ["E", "#E63E11"]] as const;
const NOVA = [["1", "#038141"], ["2", "#FECB02"], ["3", "#EE8100"], ["4", "#E63E11"]] as const;
const GREEN = [["A+", "#016B37"], ["A", "#038141"], ["B", "#85BB2F"], ["C", "#FECB02"], ["D", "#EE8100"], ["E", "#E63E11"]] as const;

export type BadgeStep = { label: string; color: string; selected: boolean; x: number; y: number; w: number; h: number };
export type BadgeCard = { title: string; x: number; y: number; w: number; h: number; steps: BadgeStep[] };

function card(slot: number, title: string, scale: readonly (readonly [string, string])[], selected: number): BadgeCard {
  const x = CARD_X0 + slot * (CARD_W + CARD_GAP);
  const n = scale.length;
  const stepW = (CARD_W - 2 * PAD - STEP_GAP * (n - 1)) / n;
  const steps = scale.map(([label, color], i) => {
    const sel = i === selected;
    const h = sel ? 78 : 50;
    return { label, color, selected: sel, x: x + PAD + i * (stepW + STEP_GAP), y: ROW_CENTER - h / 2, w: stepW, h };
  });
  return { title, x, y: CARD_Y, w: CARD_W, h: CARD_H, steps };
}

/** Which cards to draw, in fixed slots (an unknown metric leaves its slot empty). */
export function badgeCards(d: Partial<BadgeData>): BadgeCard[] {
  const cards: BadgeCard[] = [];
  if (d.nova) cards.push(card(0, "NOVA", NOVA, d.nova - 1));
  if (d.nutriscore) cards.push(card(1, "NUTRI-SCORE", NUTRI, "abcde".indexOf(d.nutriscore)));
  if (d.green) cards.push(card(2, "GREEN-SCORE", GREEN, ["a-plus", "a", "b", "c", "d", "e"].indexOf(d.green)));
  return cards;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

/** Signed distance based antialiased rounded rectangle, composited "over" the buffer. */
function fillRound(buf: Uint8Array, bw: number, bh: number, x: number, y: number, w: number, h: number, r: number, rgb: [number, number, number], alpha: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const x0 = Math.max(0, Math.floor(x) - 1);
  const x1 = Math.min(bw - 1, Math.ceil(x + w) + 1);
  const y0 = Math.max(0, Math.floor(y) - 1);
  const y1 = Math.min(bh - 1, Math.ceil(y + h) + 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = Math.abs(px + 0.5 - cx) - (w / 2 - r);
      const dy = Math.abs(py + 0.5 - cy) - (h / 2 - r);
      const dist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
      const cover = Math.min(1, Math.max(0, 0.5 - dist));
      const a = cover * alpha;
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
  const cards = badgeCards(d);
  if (cards.length === 0) return null;
  const buf = new Uint8Array(WIDTH * BADGE_STRIP_H * 4);
  for (const c of cards) {
    fillRound(buf, WIDTH, BADGE_STRIP_H, c.x, c.y - BADGE_TOP, c.w, c.h, 24, [255, 255, 255], 0.94);
    for (const s of c.steps) {
      const rgb = hex(s.color);
      const shown: [number, number, number] = s.selected ? rgb : (rgb.map((v) => Math.round(v + (255 - v) * 0.6)) as [number, number, number]);
      fillRound(buf, WIDTH, BADGE_STRIP_H, s.x, s.y - BADGE_TOP, s.w, s.h, 10, shown, 1);
    }
  }
  return encodePng(WIDTH, BADGE_STRIP_H, buf);
}

const assColor = (c: string) => {
  const [r, g, b] = hex(c);
  return `&H00${[b, g, r].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}&`;
};

/** ASS dialogue lines (titles + step letters). Styles BadgeTitle and BadgeLetter must exist. */
export function badgeDialogues(d: Partial<BadgeData>, start: string, end: string): string[] {
  const out: string[] = [];
  for (const c of badgeCards(d)) {
    out.push(`Dialogue: 1,${start},${end},BadgeTitle,,0,0,0,,{\\an5\\pos(${Math.round(c.x + c.w / 2)},${c.y + 30})}${c.title}`);
    for (const s of c.steps) {
      const fs = s.selected ? (s.label.length > 1 ? 36 : 54) : s.label.length > 1 ? 18 : 26;
      const colour = s.selected ? "&H00FFFFFF&" : assColor("#FFFFFF");
      out.push(`Dialogue: 2,${start},${end},BadgeLetter,,0,0,0,,{\\an5\\pos(${Math.round(s.x + s.w / 2)},${Math.round(s.y + s.h / 2 + 2)})\\fs${fs}\\c${colour}}${s.label}`);
    }
  }
  return out;
}
