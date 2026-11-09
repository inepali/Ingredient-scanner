import { generateText, type LlmImage } from "./llm.ts";
import { DEFAULT_TONE, TONES, parseTone, type Tone } from "./tones.ts";

export { DEFAULT_TONE, TONES, parseTone, type Tone };

// A ~60s vertical social video, split into scenes. Each scene carries a visual
// prompt (for an image-to-video model such as fal.ai) and its voiceover line.
//
// Structure: a hook, then the GOOD (green) ingredients and their health
// benefits, the FAIR (yellow) ones and whether they help, the POOR (red) ones
// and the concern behind each, then a closing question. No numeric score is
// spoken: the model is only told which group an ingredient is in.

export type Section = "hook" | "good" | "fair" | "poor" | "outro";
export const SECTIONS: Section[] = ["hook", "good", "fair", "poor", "outro"];

export type VideoScene = { seconds: number; visual: string; voiceover: string; photo?: number; section?: Section; custom?: boolean };
export type VideoScript = { title: string; scenes: VideoScene[] };

export type ScriptInput = {
  productName: string | null;
  overall: number;
  allergens: string[];
  ingredients: { name: string; score: number; reason: string | null }[];
  /** Open Food Facts cross-check, when the product was matched. */
  offFacts?: string | null;
  /** Photos of the real product sent with the request, numbered from 1 in the prompt. */
  photos?: LlmImage[];
  tone?: Tone;
};

export type Group = "good" | "fair" | "poor";

/** Green 60+, yellow 40-59, red under 40 (the report's colors, with the two greens merged). */
export function groupFor(score: number): Group {
  return score >= 60 ? "good" : score >= 40 ? "fair" : "poor";
}

export type Candidate = { name: string; reason: string | null; position: number };

const TRIVIAL = /^(water|filtered water|purified water|spring water|carbonated water)$/i;

/**
 * Ingredients worth talking about, per group: the best greens (most benefit),
 * the first yellows (biggest share of the product) and the worst reds (most
 * concern), ties broken by label position (earlier = more of it).
 */
export function pickCandidates(ings: ScriptInput["ingredients"]): Record<Group, Candidate[]> & {
  counts: Record<Group, number>;
} {
  const rows = ings.map((x, i) => ({ ...x, position: i + 1, group: groupFor(x.score) }));
  const by = (g: Group) => rows.filter((r) => r.group === g);
  const toCand = (r: (typeof rows)[number]): Candidate => ({ name: r.name, reason: r.reason, position: r.position });

  const good = by("good")
    .filter((r) => !TRIVIAL.test(r.name.trim()))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, 5);
  const fair = by("fair")
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  const poor = by("poor")
    .sort((a, b) => a.score - b.score || a.position - b.position)
    .slice(0, 5);

  return {
    good: good.map(toCand),
    fair: fair.map(toCand),
    poor: poor.map(toCand),
    counts: { good: by("good").length, fair: by("fair").length, poor: by("poor").length },
  };
}

function overallFeel(overall: number): string {
  return overall >= 70 ? "mostly on the good side" : overall >= 45 ? "a mixed bag" : "mostly on the concerning side";
}

/** About 2.5 spoken words per second: 60 seconds is roughly 145 words. */
export const MIN_WORDS = 125;
export const MAX_WORDS = 165;

export function wordCount(script: VideoScript): number {
  return script.scenes.reduce((n, sc) => n + (sc.voiceover.trim() ? sc.voiceover.trim().split(/\s+/).length : 0), 0);
}

export function buildPrompt(i: ScriptInput) {
  const photoCount = Math.min(i.photos?.length ?? 0, 4);
  const tone = TONES[i.tone ?? DEFAULT_TONE];
  const c = pickCandidates(i.ingredients);
  const lines = (list: Candidate[]) =>
    list.length === 0
      ? "(none)"
      : list.map((x) => `- ${x.name} (#${x.position} on the label)${x.reason ? `: ${x.reason}` : ""}`).join("\n");

  return `You write 60-second vertical (9:16) videos for TikTok and Instagram Reels that read a packaged food's ingredient label out loud and explain what it means for your health. You never say or show any numeric score.

TONE: ${tone.prompt}

FACTS
- Product: ${i.productName ?? "unnamed product"}
- Overall feel (say it in words if you want, never as a number): ${overallFeel(i.overall)}
- Allergens on the label: ${i.allergens.join(", ") || "none stated"}
- Ingredients on the label: ${i.ingredients.length} (${c.counts.good} good, ${c.counts.fair} fair, ${c.counts.poor} poor)
${i.offFacts ? `- Open Food Facts says: ${i.offFacts}. Use only as supporting evidence inside the good or poor section (for example, NOVA group 4 means ultra-processed), never as the headline.\n` : ""}
GOOD (green) candidates, best first:
${lines(c.good)}

FAIR (yellow) candidates:
${lines(c.fair)}

POOR (red) candidates, worst first:
${lines(c.poor)}

Return ONLY a JSON object (no markdown fences) shaped like:
{ "title": string, "scenes": [ { "section": "hook" | "good" | "fair" | "poor" | "outro", "seconds": integer, "visual": string, "voiceover": string${photoCount ? ', "photo": integer' : ""} } ] }

STRUCTURE (in this order, 7 to 9 scenes, "seconds" adding up to about 60; the retention hooks below are woven into these scenes, they are not extra scenes):
1. "hook" (about 4 s): a curiosity hook about this product that makes people stay. Do not mention a score.
2. "good" (1 or 2 scenes): choose 2 or 3 of the GOOD candidates. For each, say in plain words one health benefit it may offer ("may support digestion", "a source of protein"). Skip plain water or anything with nothing meaningful to say.
3. "fair" (1 scene): choose 1 or 2 of the FAIR candidates and say honestly whether they help your health or not ("neutral", "fine in small amounts", "doesn't add much"). Be fair, not dramatic.
4. "poor" (1 or 2 scenes): choose 2 or 3 of the POOR candidates. For each, explain the specific concern for your health in plain words (for example added sugar, a refined oil, a heavily processed additive) and why it matters. Say "may" where the science is not settled.
5. "outro" (about 8 s): a one-line takeaway in words (no number), then a "Try this instead" tip: tell people what to look for in a better version of this kind of product, as concrete label rules they can check in the shop ("look for one with five ingredients or fewer and no added sugar"). Name no brands and invent no numbers beyond simple label rules. Then finish with a short question that invites comments, such as "Do you eat this?". The very last words of the video MUST be a question.
If a group is empty, skip it with one honest line (for example, "Honestly, I didn't find much green here.").

KEEP PEOPLE WATCHING (retention hooks). Viewers tend to drop off around 10-15 seconds, so plant three hooks. Count time at about 2.5 spoken words per second:
- Hook at about 0:15: the last sentence of the scene that ends near the 15-second mark is an open-loop teaser that makes people stay for what comes next, for example "But wait until you hear what's hiding in the next one." Name no ingredient and no number in the teaser itself.
- Hook at about 0:35: the last sentence of the scene that ends near the 35-second mark is a second, stronger teaser pointing at the most concerning ingredient, which you save for after this point (put the worst POOR candidate in the final stretch). If nothing on the label is concerning, tease the one thing that surprised you.
- Closing hook: end the "outro" with the takeaway, the "Try this instead" tip, a nudge to comment, and the final question from rule 5.
Pay each teaser off within the next 10-20 seconds. A teaser must never promise something the video does not deliver, and must not be clickbait, a scare tactic or a numeric score. Plan the scene lengths so a scene boundary lands near 0:15 and near 0:35.
${
    photoCount
      ? `
${photoCount} photo${photoCount === 1 ? "" : "s"} of the actual product ${photoCount === 1 ? "is" : "are"} attached, numbered 1 to ${photoCount} in the order shown. Look at ${photoCount === 1 ? "it" : "them"} and:
- Write each "visual" about what is really visible (the packaging, colors, shape, setting), and set "photo" to the number of the photo that scene should animate. Use every photo at least once; scenes without a matching photo may omit "photo".
- Treat text printed on the packaging (for example "natural", "low sugar") as marketing, not fact. The facts above are the facts.
- Do not name a brand unless it is clearly printed on the product.
`
      : ""
  }
RULES
- "visual": one concrete sentence describing what is on screen, written as a prompt for an image-to-video model (subject, setting, camera movement). No on-screen text, no logos, no real people's names.
- "voiceover": the spoken line, about 2.5 words per second of the scene, in the tone above.
- LENGTH IS A HARD LIMIT: the whole video is about 1 minute. Total narration across all scenes must be between ${MIN_WORDS} and ${MAX_WORDS} words (aim for about 145), and "seconds" must add up to 55-62. Be concise: short sentences, no filler, no repeating yourself. The retention hooks and the closing question count toward this total.
- Only talk about ingredients listed above. Do not invent ingredients, numbers or studies.
- Health statements must be widely accepted nutrition basics, phrased with "may", "can" or "tends to", and consistent with the note shown for that ingredient. If you are not sure a benefit or concern is well established, leave that ingredient out.
- No disease claims, no "cures", "treats", "prevents", "detox" or weight-loss promises, and no scare tactics. Do not shame people for eating it.`;
}

export function parseScript(text: string): VideoScript {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON");
  const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const scenes: VideoScene[] = [];
  for (const s of Array.isArray(data.scenes) ? data.scenes.slice(0, 30) : []) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    const visual = typeof o.visual === "string" ? o.visual.trim() : "";
    const voiceover = typeof o.voiceover === "string" ? o.voiceover.trim() : "";
    const seconds = Math.round(Number(o.seconds));
    if (!visual || !voiceover) continue;
    const photo = Math.round(Number(o.photo));
    const section = SECTIONS.find((x) => x === o.section);
    scenes.push({
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 8,
      visual,
      voiceover,
      ...(Number.isInteger(photo) && photo >= 1 && photo <= 12 ? { photo } : {}),
      ...(section ? { section } : {}),
      ...(o.custom === true ? { custom: true } : {}),
    });
  }
  if (scenes.length === 0) throw new Error("Model returned no scenes");

  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Ingredient check";
  return { title, scenes };
}

/** Every script must end on a question. If the model forgot, add one. */
export function ensureHook(script: VideoScript): VideoScript {
  const last = script.scenes[script.scenes.length - 1];
  if (!last || /\?["')\]\s]*$/.test(last.voiceover)) return script;
  const scenes = script.scenes.slice(0, -1);
  scenes.push({ ...last, voiceover: `${last.voiceover.trim()} Do you eat this?` });
  return { ...script, scenes };
}

export async function createScript(input: ScriptInput): Promise<VideoScript> {
  const base = buildPrompt(input);
  let prompt = base;
  let best: VideoScript | null = null;
  let lastText = "";
  // Up to 3 tries: bad/empty output is retried as is; a draft that runs too long or short is retried with its word count.
  for (let attempt = 0; attempt < 3; attempt++) {
    lastText = await generateText(prompt, input.photos ?? []);
    let script: VideoScript;
    try {
      script = ensureHook(parseScript(lastText));
    } catch (err) {
      if (attempt === 2 && !best) {
        const snippet = lastText.trim().replace(/\s+/g, " ").slice(0, 160);
        throw new Error(`${err instanceof Error ? err.message : "Bad script"}. The model said: "${snippet || "(nothing)"}"`);
      }
      continue;
    }
    const words = wordCount(script);
    if (words >= MIN_WORDS && words <= MAX_WORDS) return script;
    // Keep the draft closest to a minute in case no retry lands in range.
    if (!best || Math.abs(words - 145) < Math.abs(wordCount(best) - 145)) best = script;
    prompt = `${base}

Your previous draft had ${words} words, which is ${words > MAX_WORDS ? "too long" : "too short"} for a 1-minute video. Rewrite it with between ${MIN_WORDS} and ${MAX_WORDS} words total (aim for 145).`;
  }
  if (best) return best;
  throw new Error("Could not write the script.");
}

/** The full spoken narration: every scene's voiceover line, in order. */
export function narration(script: VideoScript): string {
  return script.scenes
    .map((s) => s.voiceover.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

/** One line of Open Food Facts grades for prompts, or null if there is nothing to say. */
export function offFactsLine(off: {
  nutriscore: string | null;
  nova: number | null;
  green: string | null;
} | null): string | null {
  if (!off) return null;
  const parts = [
    off.nutriscore && `Nutri-Score ${off.nutriscore.toUpperCase()}`,
    off.nova && `NOVA group ${off.nova} of 4`,
    off.green && `Green-Score ${off.green === "a-plus" ? "A+" : off.green.toUpperCase()}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
