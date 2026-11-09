import { generateText } from "./llm.ts";

// TikTok / Instagram / YouTube titles, descriptions and hashtags for a scanned product.

export type SocialCopy = { title: string; description: string; hashtags: string[] };
export type CopyResult = { tiktok: SocialCopy; instagram: SocialCopy; youtube: SocialCopy };

export const AI_NOTE = "Not medical advice.";
export const CTA = "Do you eat this? Tell me in the comments.";
export const OFF_CREDIT = "Product data: Open Food Facts";

export type CopyInput = {
  productName: string | null;
  overall: number;
  scriptTitle: string | null;
  offFacts?: string | null;
  ingredients: { name: string; score: number }[]; // label order
};

/** Lowercase, strip '#', spaces and punctuation, drop empties and duplicates. */
export function normalizeHashtags(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const tag = item.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Up to 3 of your standing tags first, then generated ones, then the rest. */
export function mergeHashtags(generated: string[], curated: string[], max = 10): string[] {
  return normalizeHashtags([...curated.slice(0, 3), ...generated, ...curated.slice(3)]).slice(0, max);
}

function cleanCopy(v: unknown, titleMax: number, descMax: number, credit: boolean, tagMax = 10): SocialCopy {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const title = (typeof o.title === "string" ? o.title.trim() : "").slice(0, titleMax);
  const desc = (typeof o.description === "string" ? o.description.trim() : "").slice(0, descMax);
  return {
    title,
    // body, call to action, disclaimer (the public link goes right after it), then the data credit
    description: [desc, CTA, AI_NOTE, credit ? OFF_CREDIT : ""].filter(Boolean).join("\n\n"),
    hashtags: normalizeHashtags(o.hashtags).slice(0, tagMax),
  };
}

/** `offCredit`: the scan used Open Food Facts data, so credit them (their licence asks for it). */
export function parseCopy(text: string, offCredit = false): CopyResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON");
  const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  return {
    tiktok: cleanCopy(data.tiktok, 100, 300, offCredit),
    instagram: cleanCopy(data.instagram, 100, 600, offCredit),
    // Older or sloppy answers may lack a YouTube block: fall back to the Instagram text.
    youtube: cleanCopy(data.youtube ?? data.instagram, 100, 900, offCredit, 25),
  };
}

function buildPrompt(i: CopyInput): string {
  const list = (items: { name: string; score: number }[]) =>
    items.map((x) => `${x.name} (${x.score})`).join(", ") || "none";
  const byScore = [...i.ingredients].sort((a, b) => a.score - b.score);
  return `Write post copy for a TikTok, an Instagram Reel and a YouTube Short about a packaged food's ingredient scan.

Facts (use ONLY these; do not invent numbers, brands or health claims):
- Product: ${i.productName ?? "unnamed product"}
- Overall score: ${i.overall}/100 (100 = healthiest)
- Video title: ${i.scriptTitle ?? "n/a"}
${i.offFacts ? `- Open Food Facts: ${i.offFacts}\n` : ""}- Lowest scoring (score): ${list(byScore.slice(0, 3))}
- Highest scoring (score): ${list(byScore.slice(-2).reverse())}

Return ONLY a JSON object, no markdown fences:
{"tiktok": {"title": max 90 chars, "description": max 250 chars, "hashtags": 3 to 5 words without the # sign, mixing one or two broad tags with niche ones},
 "instagram": {"title": max 90 chars, "description": max 500 chars, "hashtags": 3 to 5 words without the # sign, mixing one or two broad tags with niche ones},
 "youtube": {"title": max 90 chars, searchable: the product name plus a plain hook such as "ingredients, honestly", "description": max 700 chars, first sentence is a keyword-rich summary of what the video shows, then 1-2 short lines of detail, "hashtags": 18 to 20 words without the # sign, no duplicates, ordered most important first: broad (food, nutrition, healthyeating), topic (ingredients, foodlabel, nutriscore), and product-specific search terms. They are used as YouTube tags}}
No medical or disease claims, no emoji spam.`;
}

export async function createCopy(input: CopyInput): Promise<CopyResult> {
  return parseCopy(await generateText(buildPrompt(input)), Boolean(input.offFacts));
}
