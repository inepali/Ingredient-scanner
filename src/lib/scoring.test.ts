import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, normalizeName, overallScore } from "./scoring.ts";
import { parseAnalysis } from "./analyze.ts";

test("bandFor covers every boundary", () => {
  assert.equal(bandFor(100), "great");
  assert.equal(bandFor(80), "great");
  assert.equal(bandFor(79), "good");
  assert.equal(bandFor(60), "good");
  assert.equal(bandFor(59), "fair");
  assert.equal(bandFor(40), "fair");
  assert.equal(bandFor(39), "poor");
  assert.equal(bandFor(20), "poor");
  assert.equal(bandFor(19), "avoid");
  assert.equal(bandFor(0), "avoid");
});

test("normalizeName strips noise", () => {
  assert.equal(normalizeName("Organic Cane Sugar (3%)"), "cane sugar");
  assert.equal(normalizeName("FD&C Red No. 40"), "fd c red no 40");
  assert.equal(normalizeName("  Wheat   Flour (Enriched) "), "wheat flour");
  assert.equal(normalizeName("Salt, 2% "), "salt");
});

test("overallScore: position-weighted average", () => {
  // weights 1, 1/2, 1/3 -> (90 + 25 + 6.667) / 1.8333 = 66.4
  assert.equal(
    overallScore([
      { name: "a", score: 90 },
      { name: "b", score: 50 },
      { name: "c", score: 20 },
    ]),
    66,
  );
});

test("overallScore: first ingredient matters most", () => {
  const sugarFirst = overallScore([
    { name: "sugar", score: 25 },
    { name: "oats", score: 85 },
  ]);
  const oatsFirst = overallScore([
    { name: "oats", score: 85 },
    { name: "sugar", score: 25 },
  ]);
  assert.ok(oatsFirst > sugarFirst);
});

test("overallScore: an ingredient under 20 caps the overall at 60", () => {
  assert.equal(
    overallScore([
      { name: "oats", score: 90 },
      { name: "red 40", score: 10 },
    ]),
    60,
  );
});

test("overallScore: partially hydrogenated oil caps the overall at 30", () => {
  assert.equal(
    overallScore([
      { name: "oats", score: 95 },
      { name: "partially hydrogenated soybean oil", score: 5 },
    ]),
    30,
  );
});

test("overallScore: empty list is 0", () => {
  assert.equal(overallScore([]), 0);
});

test("parseAnalysis: extracts JSON from fenced text and sanitizes", () => {
  const out = parseAnalysis(
    'Here you go:\n```json\n{"legible": true, "product_name": " Oat Bar ", "ingredients": [' +
      '{"raw_name": "Oats", "canonical_name": "oats", "provisional_score": 140.4, "reason": "Whole grain."},' +
      '{"raw_name": "", "canonical_name": "x", "provisional_score": 10, "reason": "skip me"},' +
      '{"raw_name": "Sugar", "provisional_score": "abc"}' +
      '], "allergens": ["Wheat", 5]}\n```',
  );
  assert.equal(out.legible, true);
  assert.equal(out.product_name, "Oat Bar");
  assert.equal(out.ingredients.length, 2);
  assert.equal(out.ingredients[0].provisional_score, 100);
  assert.equal(out.ingredients[1].canonical_name, "Sugar");
  assert.equal(out.ingredients[1].provisional_score, 50);
  assert.deepEqual(out.allergens, ["wheat"]);
});

test("parseAnalysis: unreadable label", () => {
  const out = parseAnalysis('{"legible": false, "product_name": null, "ingredients": [], "allergens": []}');
  assert.equal(out.legible, false);
  assert.equal(out.ingredients.length, 0);
});

test("parseAnalysis: throws when there is no JSON", () => {
  assert.throws(() => parseAnalysis("Sorry, I can't read that."));
});
