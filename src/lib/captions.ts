import { RING_SIZE } from "./render.ts";
import { badgeDialogues, badgeTimes, type BadgeData } from "./badges.ts";
// ElevenLabs returns character-level timings. Captions need word-level timings.

export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type Word = { text: string; start: number; end: number };

export function wordsFromAlignment(a: Alignment): Word[] {
  const n = Math.min(
    a.characters.length,
    a.character_start_times_seconds.length,
    a.character_end_times_seconds.length,
  );
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;

  for (let i = 0; i < n; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (text) words.push({ text, start, end });
      text = "";
      continue;
    }
    if (!text) start = a.character_start_times_seconds[i];
    text += ch;
    end = a.character_end_times_seconds[i];
  }
  if (text) words.push({ text, start, end });
  return words;
}

// ---------- captions (ASS subtitles burned into the video) ----------

/** Groups words into short caption lines (max 4 words / ~20 characters). */
export function captionChunks(words: Word[], maxWords = 4, maxChars = 20): Word[] {
  const chunks: Word[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    chunks.push({ text: cur.map((w) => w.text).join(" "), start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length >= maxWords || (cur.length > 0 && len > maxChars)) flush();
    cur.push(w);
    // Break after sentence-ending punctuation so lines don't straddle sentences.
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();

  // Hold each line until the next starts (no flicker), but never past a 0.4 s gap.
  return chunks.map((c, i) => {
    const next = chunks[i + 1];
    const end = next && next.start - c.end < 0.4 ? next.start : c.end + 0.15;
    return { ...c, end: Math.max(end, c.start + 0.25) };
  });
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function assText(t: string): string {
  return t.replace(/\\/g, "").replace(/[{}]/g, "").toUpperCase();
}

/**
 * ASS subtitle file for a 1080x1920 video: bold white captions with a black
 * outline in the lower third (clear of TikTok/Reels buttons) and the score number
 * for the ring overlay at the top for the whole video.
 */
/** Rounded-end arc (a short stroke of the ring) as an ASS vector path, in absolute video pixels, starting at the top. */
function spinnerPath(cx: number, cy: number, radius: number, stroke: number, sweepDeg: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (r: number, deg: number): [number, number] => [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))];
  const pts: [number, number][] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) pts.push(at(radius + stroke / 2, (sweepDeg * i) / steps));
  // Round cap at the far end (outer edge -> forward -> inner edge), inner edge back, round cap at the start.
  const cap = (deg: number, forward: 1 | -1, fromOuter: boolean) => {
    const [ex, ey] = at(radius, deg);
    const u = [Math.sin(rad(deg)), -Math.cos(rad(deg))];
    const t = [Math.cos(rad(deg)), Math.sin(rad(deg))];
    for (let i = 1; i < 8; i++) {
      const f = (i * Math.PI) / 8;
      const side = fromOuter ? 1 : -1;
      pts.push([ex + (stroke / 2) * (side * u[0] * Math.cos(f) + forward * t[0] * Math.sin(f)), ey + (stroke / 2) * (side * u[1] * Math.cos(f) + forward * t[1] * Math.sin(f))]);
    }
  };
  cap(sweepDeg, 1, true);
  for (let i = steps; i >= 0; i--) pts.push(at(radius - stroke / 2, (sweepDeg * i) / steps));
  cap(0, -1, false);
  const f = (p: [number, number]) => `${Math.round(p[0])} ${Math.round(p[1])}`;
  return `m ${f(pts[0])} l ${pts.slice(1).map(f).join(" ")}`;
}

const SPIN_COLORS = ["#038141", "#85BB2F", "#FECB02", "#EE8100", "#E63E11"]; // the five rating colours
const assColor = (c: string) => `&H${[5, 3, 1].map((i) => c.slice(i, i + 2)).join("").toUpperCase()}&`;

/** \\1c tags that hop between the five rating colours in a (repeatable) shuffled order, then settle on `final` for the last second. */
function spinnerColors(reveal: number, final: string, seed: number): string {
  const STEP = 0.6;
  let x = (Math.round(seed) * 9301 + 49297) % 233280;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const tags: string[] = [];
  let prev = -1;
  const hops = Math.max(1, Math.floor((reveal - 1) / STEP));
  for (let i = 1; i <= hops; i++) {
    let k = Math.floor(rnd() * SPIN_COLORS.length);
    if (k === prev) k = (k + 1) % SPIN_COLORS.length;
    prev = k;
    const t = i * STEP;
    tags.push(`\\t(${Math.round((t - 0.25) * 1000)},${Math.round(t * 1000)},\\1c${assColor(SPIN_COLORS[k])})`);
  }
  tags.push(`\\t(${Math.round((reveal - 1) * 1000)},${Math.round((reveal - 0.4) * 1000)},\\1c${assColor(final)})`);
  return tags.join("");
}

/** Distance (px, in a 1080-wide video) from the ring centre to the HEALTHY / SCORE labels. */
const RING_LABEL_OFFSET = 80;

export function buildAss(opts: {
  words: Word[];
  duration: number;
  fontName: string;
  /** Overall score; drawn as the number inside the ring overlay. */
  score?: number | null;
  /** Centre of the ring overlay, in video pixels. */
  ringCenter?: { x: number; y: number };
  /** Seconds into the video when the score number replaces the "?" in the ring. */
  revealAt?: number;
  /** Colour of the real score arc; the spinner settles on it just before the reveal. */
  ringColor?: string;
  /** Seconds when each badge card appears (same order as the cards). Defaults to revealAt. */
  badgeAt?: number[];
  /** NOVA / Nutri-Score / Green-Score cards along the bottom (only the known ones are drawn). */
  badges?: Partial<BadgeData>;
  width?: number;
  height?: number;
}): string {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const lines = captionChunks(opts.words).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`,
  );
  const show = assTime(Math.max(0, opts.revealAt ?? 0));
  const end = assTime(opts.duration);
  if (opts.score != null) {
    const c = opts.ringCenter ?? { x: Math.round(W / 2), y: 400 };
    const reveal = opts.revealAt ?? 0;
    // The ring is up from the first frame. Its number is a "?" until the reveal.
    if (reveal > 0) lines.push(`Dialogue: 1,${assTime(0)},${show},RingScore,,0,0,0,,{\\an5\\pos(${c.x},${c.y})}?`);
    if (reveal > 0) {
      // A short blue arc circling the empty ring while the score is hidden (vector drawing, so it costs nothing to render).
      const k = RING_SIZE / 132;
      const turns = (reveal / 1.4) * 360;
      lines.push(
        `Dialogue: 1,${assTime(0)},${show},Spin,,0,0,0,,{\\an7\\pos(0,0)\\org(${c.x},${c.y})\\1c${assColor(SPIN_COLORS[0])}\\bord0\\shad0${spinnerColors(reveal, opts.ringColor ?? "#facc15", opts.score)}\\t(0,${Math.round(reveal * 1000)},\\frz-${Math.round(turns)})\\p1}${spinnerPath(c.x, c.y, 54 * k, 10 * k, 100)}`,
      );
    }
    lines.push(`Dialogue: 1,${show},${end},RingScore,,0,0,0,,{\\an5\\pos(${c.x},${c.y})}${Math.round(opts.score)}`);
    // "HEALTHY" above the number and "SCORE" below it, inside the ring.
    for (const [text, dy] of [["HEALTHY", -RING_LABEL_OFFSET], ["SCORE", RING_LABEL_OFFSET]] as const) {
      lines.push(`Dialogue: 1,${assTime(0)},${end},RingLabel,,0,0,0,,{\\an5\\pos(${c.x},${c.y + dy})}${text}`);
    }
  }
  if (opts.badges) {
    const at = opts.badgeAt ?? badgeTimes(opts.badges, opts.words, opts.revealAt ?? 0);
    lines.push(...badgeDialogues(opts.badges, at.map(assTime), end));
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${opts.fontName},78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,1,2,70,70,640,1
Style: RingLabel,${opts.fontName},38,&H00525252,&H00525252,&H00525252,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1
Style: BadgeTitle,${opts.fontName},24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,5,0,0,0,1
Style: BadgeLetter,${opts.fontName},40,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Spin,${opts.fontName},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: RingScore,${opts.fontName},130,&H00171717,&H00171717,&H00171717,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}
