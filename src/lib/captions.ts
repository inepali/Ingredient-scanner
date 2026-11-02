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
 * outline in the lower third (clear of TikTok/Reels buttons) and a score badge
 * at the top for the whole video.
 */
export function buildAss(opts: {
  words: Word[];
  duration: number;
  fontName: string;
  scoreLabel?: string | null;
  width?: number;
  height?: number;
}): string {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const lines = captionChunks(opts.words).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`,
  );
  if (opts.scoreLabel) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(opts.duration)},Badge,,0,0,0,,${assText(opts.scoreLabel)}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${opts.fontName},78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,1,2,70,70,520,1
Style: Badge,${opts.fontName},52,&H00FFFFFF,&H00FFFFFF,&H00222222,&H00222222,-1,0,0,0,100,100,2,0,3,16,0,8,40,40,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}
