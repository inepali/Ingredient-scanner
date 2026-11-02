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
