import type { VideoScene, VideoScript } from "./script.ts";

// Your own lines for the voiceover: a reusable list (hooks, "what I did", catchphrases) kept in settings.
// Lines you tick are woven into the script as extra scenes when a voice take is made, so captions and visuals follow.

export type LinePosition = "start" | "middle" | "end";
export const POSITIONS: { id: LinePosition; label: string }[] = [
  { id: "start", label: "Start (opening hook)" },
  { id: "middle", label: "Middle" },
  { id: "end", label: "End (before the closing question)" },
];
export type CustomLine = { id: string; text: string; position: LinePosition; enabled: boolean };

const MAX_LINES = 30;
const MAX_TEXT = 220;

/** Cleans whatever came from the browser or the database into a safe list. */
export function cleanLines(input: unknown): CustomLine[] {
  if (!Array.isArray(input)) return [];
  const out: CustomLine[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const text = (typeof o.text === "string" ? o.text : "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const position = POSITIONS.find((p) => p.id === o.position)?.id ?? "start";
    let id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 40) : "";
    if (!id || seen.has(id)) id = `l${out.length + 1}-${Math.abs(hash(text)).toString(36)}`;
    seen.add(id);
    out.push({ id, text, position, enabled: o.enabled !== false });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const sceneFor = (text: string): VideoScene => ({
  seconds: Math.max(2, Math.round(text.split(/\s+/).length / 2.5)),
  visual: "Your own line (keeps the picture from the scene before it)",
  voiceover: text,
  custom: true,
});

/** Removes earlier custom scenes, then adds the enabled lines at their spots. Never mutates the input. */
export function withCustomLines(script: VideoScript, lines: CustomLine[]): VideoScript {
  const base = script.scenes.filter((s) => !s.custom);
  const on = lines.filter((l) => l.enabled && l.text.trim());
  const pick = (p: LinePosition) => on.filter((l) => l.position === p).map((l) => sceneFor(l.text));
  const middleAt = Math.ceil(base.length / 2);
  const lastIsOutro = base.length > 1;
  const endAt = lastIsOutro ? base.length - 1 : base.length;
  const scenes = [
    ...pick("start"),
    ...base.slice(0, middleAt),
    ...pick("middle"),
    ...base.slice(middleAt, endAt),
    ...pick("end"),
    ...base.slice(endAt),
  ];
  return { ...script, scenes };
}
