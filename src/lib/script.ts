import { generateText, type LlmImage } from "./llm.ts";

// A ~60s vertical social video, split into scenes. Each scene carries a visual
// prompt (for an image-to-video model such as fal.ai) and its voiceover line.
export type VideoScene = { seconds: number; visual: string; voiceover: string; photo?: number };
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
};

function buildPrompt(i: ScriptInput) {
  const photoCount = Math.min(i.photos?.length ?? 0, 4);
  const list = i.ingredients
    .slice(0, 40)
    .map((x) => `${x.name} (${x.score}/100${x.reason ? `: ${x.reason}` : ""})`)
    .join("\n");
  return `Write a script for a 60-second vertical (9:16) social video (TikTok/Instagram Reels) about a packaged food, based on its ingredient label scan.

Product: ${i.productName ?? "unnamed product"}
Overall score: ${i.overall}/100 (100 is healthiest)
Allergens: ${i.allergens.join(", ") || "none stated"}
${i.offFacts ? `Open Food Facts says: ${i.offFacts}\n` : ""}Ingredients in label order with scores:
${list}

Return ONLY a JSON object (no markdown fences) shaped like:
{ "title": string, "scenes": [ { "seconds": integer, "visual": string, "voiceover": string${photoCount ? ", \"photo\": integer" : ""} } ] }

${
    photoCount
      ? `
${photoCount} photo${photoCount === 1 ? "" : "s"} of the actual product ${photoCount === 1 ? "is" : "are"} attached, numbered 1 to ${photoCount} in the order shown. Look at ${photoCount === 1 ? "it" : "them"} and:
- Write each "visual" about what is really visible (the packaging, colors, shape, setting), and set "photo" to the number of the photo that scene should animate. Use every photo at least once; scenes without a matching photo may omit "photo".
- Treat text printed on the packaging (for example "natural", "low sugar") as marketing, not fact. The scores above are the facts.
- Do not name a brand unless it is clearly printed on the product.
`
      : ""
  }
Rules:
- 6 to 8 scenes whose "seconds" add up to about 60.
- Scene 1 is a hook in the first 3 seconds; the last scene is a short call to action.
- "visual": one concrete sentence describing what is on screen, written as a prompt for an image-to-video model (subject, setting, camera movement). No on-screen text, no logos, no real people's names.
- "voiceover": the spoken line, conversational, about 2.5 words per second of the scene.
- Highlight the 2-3 best and worst ingredients using only the facts and scores above. Do not invent ingredients. If Open Food Facts grades are given, you may mention them by name (Nutri-Score, NOVA, Green-Score) and nothing beyond them.
- No medical or disease claims, no "cures", "detox" or weight-loss promises. Say "may" and keep it about nutrition and processing.`;
}

export function parseScript(text: string): VideoScript {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON");
  const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const scenes: VideoScene[] = [];
  for (const s of Array.isArray(data.scenes) ? data.scenes.slice(0, 12) : []) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    const visual = typeof o.visual === "string" ? o.visual.trim() : "";
    const voiceover = typeof o.voiceover === "string" ? o.voiceover.trim() : "";
    const seconds = Math.round(Number(o.seconds));
    if (!visual || !voiceover) continue;
    const photo = Math.round(Number(o.photo));
    scenes.push({
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 8,
      visual,
      voiceover,
      ...(Number.isInteger(photo) && photo >= 1 && photo <= 12 ? { photo } : {}),
    });
  }
  if (scenes.length === 0) throw new Error("Model returned no scenes");

  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Ingredient check";
  return { title, scenes };
}

export async function createScript(input: ScriptInput): Promise<VideoScript> {
  return parseScript(await generateText(buildPrompt(input), input.photos ?? []));
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
