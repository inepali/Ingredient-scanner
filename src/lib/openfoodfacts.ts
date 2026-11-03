import { normalizeName } from "./scoring.ts";

// Open Food Facts (world.openfoodfacts.org) cross-check: Nutri-Score, NOVA and
// Green-Score for the same product, blended into the overall score.
// Data is ODbL licensed: show attribution wherever it appears.

export type Nutrients = {
  sugars_100g?: number;
  salt_100g?: number;
  saturated_fat_100g?: number;
  fiber_100g?: number;
  proteins_100g?: number;
};

export type OffSummary = {
  code: string;
  name: string | null;
  brands: string | null;
  url: string;
  nutriscore: "a" | "b" | "c" | "d" | "e" | null;
  nova: 1 | 2 | 3 | 4 | null;
  green: "a-plus" | "a" | "b" | "c" | "d" | "e" | null;
  palmOil: boolean | null;
  additives: string[]; // e-numbers, e.g. "e330"
  nutrients: Nutrients;
  confidence: number; // 0-1: how sure we are this is the scanned product
  matchedBy: "barcode" | "search";
};

export type ScannedProduct = { name: string | null; ingredients: string[]; barcode: string | null };

const FIELDS = [
  "code",
  "product_name",
  "brands",
  "ingredients_text",
  "nutriscore_grade",
  "nova_group",
  "ecoscore_grade",
  "environmental_score_grade",
  "ingredients_analysis_tags",
  "additives_tags",
  "nutriments",
].join(",");

// Below this the match is too uncertain to move the score.
export const MIN_CONFIDENCE = 0.6;
// Share of the final score that comes from Open Food Facts when we have a match.
export const EXTERNAL_WEIGHT = 0.4;

// ---------- pure helpers (unit tested) ----------

const NUTRI_POINTS: Record<string, number> = { a: 100, b: 75, c: 50, d: 25, e: 0 };
const NOVA_POINTS: Record<number, number> = { 1: 100, 2: 80, 3: 45, 4: 10 };
const GREEN_POINTS: Record<string, number> = { "a-plus": 100, a: 100, b: 75, c: 50, d: 25, e: 0 };

/**
 * 0-100 score from the three grades. Health signals dominate: Nutri-Score 50%,
 * NOVA 35%, Green-Score 15% (environmental, so a small share). Missing grades
 * are left out and the rest are re-weighted. Null if none are known.
 */
export function externalScore(o: Pick<OffSummary, "nutriscore" | "nova" | "green">): number | null {
  const parts: { points: number; weight: number }[] = [];
  if (o.nutriscore) parts.push({ points: NUTRI_POINTS[o.nutriscore], weight: 0.5 });
  if (o.nova) parts.push({ points: NOVA_POINTS[o.nova], weight: 0.35 });
  if (o.green) parts.push({ points: GREEN_POINTS[o.green], weight: 0.15 });
  if (parts.length === 0) return null;
  const total = parts.reduce((s, p) => s + p.weight, 0);
  return Math.round(parts.reduce((s, p) => s + p.points * p.weight, 0) / total);
}

/** Mixes the ingredient-based score with the Open Food Facts score. */
export function blendScores(labelScore: number, external: number | null, weight = EXTERNAL_WEIGHT): number {
  if (external === null) return labelScore;
  return Math.round(labelScore * (1 - weight) + external * weight);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function ingredientNames(text: string): Set<string> {
  // Split on commas/semicolons, then drop parentheses detail.
  return new Set(
    text
      .split(/[,;()[\]]/)
      .map((p) => normalizeName(p))
      .filter(Boolean),
  );
}

/**
 * How likely a search hit is the scanned product: mostly ingredient-list
 * overlap (hard to fake), a little product-name word overlap.
 */
export function matchConfidence(
  scanned: Pick<ScannedProduct, "name" | "ingredients">,
  hit: { product_name?: string | null; brands?: string | null; ingredients_text?: string | null },
): number {
  const mine = new Set(scanned.ingredients.map((i) => normalizeName(i)).filter(Boolean));
  const theirs = ingredientNames(hit.ingredients_text ?? "");
  let ing = 0;
  if (mine.size > 0 && theirs.size > 0) {
    let shared = 0;
    for (const n of mine) if (theirs.has(n)) shared++;
    ing = shared / Math.max(mine.size, theirs.size);
  }

  let name = 0;
  if (scanned.name) {
    const want = tokens(scanned.name);
    const have = tokens(`${hit.brands ?? ""} ${hit.product_name ?? ""}`);
    if (want.size > 0) {
      let shared = 0;
      for (const t of want) if (have.has(t)) shared++;
      name = shared / want.size;
    }
  }
  return Math.round((0.7 * ing + 0.3 * name) * 100) / 100;
}

type RawProduct = Record<string, unknown>;

function grade<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as T)
    : null;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** Maps one Open Food Facts product object to our summary (confidence set by caller). */
export function parseProduct(p: RawProduct): Omit<OffSummary, "confidence" | "matchedBy"> | null {
  const code = typeof p.code === "string" ? p.code : typeof p.code === "number" ? String(p.code) : "";
  if (!code) return null;

  const novaRaw = Number(p.nova_group);
  const nova = [1, 2, 3, 4].includes(novaRaw) ? (novaRaw as 1 | 2 | 3 | 4) : null;

  const tags = Array.isArray(p.ingredients_analysis_tags) ? (p.ingredients_analysis_tags as unknown[]) : [];
  const palmOil = tags.includes("en:palm-oil")
    ? true
    : tags.includes("en:palm-oil-free")
      ? false
      : null;

  const additives = (Array.isArray(p.additives_tags) ? (p.additives_tags as unknown[]) : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^en:/, ""))
    .slice(0, 30);

  const n = (typeof p.nutriments === "object" && p.nutriments !== null ? p.nutriments : {}) as RawProduct;
  const nutrients: Nutrients = {
    sugars_100g: num(n["sugars_100g"]),
    salt_100g: num(n["salt_100g"]),
    saturated_fat_100g: num(n["saturated-fat_100g"]),
    fiber_100g: num(n["fiber_100g"]),
    proteins_100g: num(n["proteins_100g"]),
  };

  return {
    code,
    name: typeof p.product_name === "string" && p.product_name.trim() ? p.product_name.trim() : null,
    brands: typeof p.brands === "string" && p.brands.trim() ? p.brands.trim() : null,
    url: `https://world.openfoodfacts.org/product/${code}`,
    nutriscore: grade(p.nutriscore_grade, ["a", "b", "c", "d", "e"] as const),
    nova,
    // Green-Score is the new name for Eco-Score; the API still serves it as ecoscore_*.
    green: grade(p.environmental_score_grade ?? p.ecoscore_grade, ["a-plus", "a", "b", "c", "d", "e"] as const),
    palmOil,
    additives,
    nutrients,
  };
}

// ---------- network ----------

function headers() {
  // Open Food Facts asks every app to identify itself.
  return { "user-agent": "IngredientScanner/0.1 (personal tool)" };
}

async function getJson(url: string): Promise<RawProduct | null> {
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return (await res.json()) as RawProduct;
}

/**
 * Finds the scanned product on Open Food Facts: by barcode if one was read,
 * otherwise by name, accepting only a confident match. Returns null on any
 * miss or error; a lookup problem must never block the scan.
 */
export async function lookupProduct(scanned: ScannedProduct): Promise<OffSummary | null> {
  try {
    if (scanned.barcode) {
      const data = await getJson(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(scanned.barcode)}?fields=${FIELDS}`,
      );
      const product = data?.status === 1 ? (data.product as RawProduct | undefined) : undefined;
      const parsed = product ? parseProduct({ code: scanned.barcode, ...product }) : null;
      if (parsed) return { ...parsed, confidence: 1, matchedBy: "barcode" };
    }

    if (!scanned.name) return null;
    const data = await getJson(
      "https://world.openfoodfacts.org/cgi/search.pl?" +
        new URLSearchParams({
          search_terms: scanned.name,
          search_simple: "1",
          action: "process",
          json: "1",
          page_size: "10",
          fields: FIELDS,
        }),
    );
    const hits = Array.isArray(data?.products) ? (data.products as RawProduct[]) : [];

    let best: { summary: Omit<OffSummary, "confidence" | "matchedBy">; confidence: number } | null = null;
    for (const hit of hits) {
      const summary = parseProduct(hit);
      if (!summary) continue;
      const confidence = matchConfidence(scanned, {
        product_name: summary.name,
        brands: summary.brands,
        ingredients_text: typeof hit.ingredients_text === "string" ? hit.ingredients_text : "",
      });
      if (!best || confidence > best.confidence) best = { summary, confidence };
    }
    if (!best || best.confidence < MIN_CONFIDENCE) return null;
    return { ...best.summary, confidence: best.confidence, matchedBy: "search" };
  } catch (err) {
    console.error("Open Food Facts lookup failed:", err);
    return null;
  }
}


// ---------- barcode lookup ----------

/** EAN-8 / UPC-A (12) / EAN-13 / GTIN-14 with a valid GS1 check digit. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

export type BarcodeProduct = { summary: OffSummary; ingredientsText: string | null };

/** The product for a scanned barcode, or null if Open Food Facts doesn't know it. */
export async function fetchByBarcode(code: string): Promise<BarcodeProduct | null> {
  const data = await getJson(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=${FIELDS}`,
  );
  const product = data?.status === 1 ? (data.product as RawProduct | undefined) : undefined;
  const parsed = product ? parseProduct({ code, ...product }) : null;
  if (!product || !parsed) return null;
  const text = typeof product.ingredients_text === "string" ? product.ingredients_text.trim() : "";
  return {
    summary: { ...parsed, confidence: 1, matchedBy: "barcode" },
    ingredientsText: text.length >= 3 ? text.slice(0, 4000) : null,
  };
}
