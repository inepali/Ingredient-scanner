// Reads an ingredient-label photo with Claude and returns structured JSON.
// Uses plain fetch so there is no SDK dependency.

export type AnalyzedIngredient = {
  raw_name: string;
  canonical_name: string;
  provisional_score: number;
  reason: string;
};

export type LabelAnalysis = {
  legible: boolean;
  product_name: string | null;
  ingredients: AnalyzedIngredient[];
  allergens: string[];
};

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

const PROMPT = `You are reading a photo of a packaged-food ingredient label. Extract the ingredient list exactly as printed, in label order, and rate each ingredient for healthfulness.

Return ONLY a JSON object (no markdown fences, no commentary) with this shape:
{
  "legible": boolean,
  "product_name": string | null,
  "ingredients": [
    {
      "raw_name": string,
      "canonical_name": string,
      "provisional_score": integer,
      "reason": string
    }
  ],
  "allergens": string[]
}

Field rules:
- legible: false if you cannot read an ingredient list in the photo.
- product_name: only if it is printed in this photo, otherwise null.
- raw_name: the ingredient as printed, without percentages or parenthetical detail.
- canonical_name: the plain lowercase common name (for example "cane sugar" for "Organic Evaporated Cane Juice").
- provisional_score: 0-100 where 100 is healthiest. Guide: 80-100 whole or minimally processed foods (vegetables, legumes, whole grains, nuts, water); 60-79 lightly processed (olive oil, spices, vinegar, dairy); 40-59 refined or neutral (refined flour, salt, natural flavors); 20-39 added sugars, refined seed oils, many additives; 0-19 partially hydrogenated oils, some synthetic dyes and preservatives.
- reason: one short factual sentence (max 20 words) about nutrition or processing. Do not make medical or disease claims.
- allergens: allergens stated on the label (for example "milk", "wheat"), lowercase. Empty array if none.

Rules: list sub-ingredients of compound ingredients as their own entries right after the parent's position, keeping label order. Never invent ingredients. Skip anything you cannot read.`;

type AnthropicResponse = { content?: { type: string; text?: string }[] };

export async function analyzeLabel(image: Buffer, mediaType: string): Promise<LabelAnalysis> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image.toString("base64") },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as AnthropicResponse;
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  return parseAnalysis(text);
}

/** Pulls the JSON object out of the model's reply and sanitizes every field. */
export function parseAnalysis(text: string): LabelAnalysis {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON");

  const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const list: unknown[] = Array.isArray(data.ingredients) ? data.ingredients : [];

  const ingredients: AnalyzedIngredient[] = [];
  for (const item of list.slice(0, 80)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;

    const raw = typeof o.raw_name === "string" ? o.raw_name.trim() : "";
    if (!raw) continue;

    const canonical =
      typeof o.canonical_name === "string" && o.canonical_name.trim()
        ? o.canonical_name.trim()
        : raw;
    const n = Number(o.provisional_score);
    const score = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";

    ingredients.push({ raw_name: raw, canonical_name: canonical, provisional_score: score, reason });
  }

  const productName =
    typeof data.product_name === "string" && data.product_name.trim()
      ? data.product_name.trim()
      : null;
  const allergens = Array.isArray(data.allergens)
    ? data.allergens
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    : [];

  return {
    legible: data.legible !== false && ingredients.length > 0,
    product_name: productName,
    ingredients,
    allergens,
  };
}
