import { test } from "node:test";
import assert from "node:assert/strict";
import { blendScores, externalScore, matchConfidence, parseProduct } from "./openfoodfacts.ts";
import { applyCaps } from "./scoring.ts";
import { offFactsLine } from "./script.ts";

test("externalScore weights Nutri-Score, NOVA and Green-Score", () => {
  // a=100*.5, nova1=100*.35, a-plus=100*.15
  assert.equal(externalScore({ nutriscore: "a", nova: 1, green: "a-plus" }), 100);
  // e=0, nova4=10, e=0 -> 3.5
  assert.equal(externalScore({ nutriscore: "e", nova: 4, green: "e" }), 4);
  // b=75*.5 + 3=45*.35 -> (37.5+15.75)/.85 = 62.6
  assert.equal(externalScore({ nutriscore: "b", nova: 3, green: null }), 63);
  assert.equal(externalScore({ nutriscore: null, nova: null, green: null }), null);
});

test("blendScores uses 60/40 and passes through without outside data", () => {
  assert.equal(blendScores(80, 20), 56);
  assert.equal(blendScores(80, null), 80);
});

test("caps still apply after blending", () => {
  const items = [{ name: "sugar", score: 10 }];
  assert.equal(applyCaps(90, items), 60);
  assert.equal(applyCaps(90, [{ name: "partially hydrogenated oil", score: 5 }]), 30);
});

test("matchConfidence: same ingredient list beats a different product", () => {
  const scanned = {
    name: "Choco Spread",
    ingredients: ["sugar", "palm oil", "hazelnuts", "cocoa", "skim milk powder"],
  };
  const same = matchConfidence(scanned, {
    product_name: "Choco Spread",
    brands: "Acme",
    ingredients_text: "Sugar, palm oil, hazelnuts (13%), cocoa, skim milk powder",
  });
  const other = matchConfidence(scanned, {
    product_name: "Choco Cereal",
    brands: "Other",
    ingredients_text: "Wheat flour, sugar, cocoa, salt",
  });
  assert.ok(same >= 0.9, `same=${same}`);
  assert.ok(other < 0.6, `other=${other}`);
});

test("parseProduct maps Open Food Facts fields", () => {
  const p = parseProduct({
    code: "3017620422003",
    product_name: " Nutella ",
    brands: "Ferrero",
    nutriscore_grade: "E",
    nova_group: 4,
    ecoscore_grade: "d",
    ingredients_analysis_tags: ["en:palm-oil", "en:vegetarian"],
    additives_tags: ["en:e322", "en:e476"],
    nutriments: { sugars_100g: 56.3, salt_100g: "0.107", "saturated-fat_100g": 10.6 },
  });
  assert.ok(p);
  assert.equal(p.name, "Nutella");
  assert.equal(p.nutriscore, "e");
  assert.equal(p.nova, 4);
  assert.equal(p.green, "d");
  assert.equal(p.palmOil, true);
  assert.deepEqual(p.additives, ["e322", "e476"]);
  assert.equal(p.nutrients.salt_100g, 0.11);
  assert.equal(p.nutrients.saturated_fat_100g, 10.6);
  assert.equal(p.url, "https://world.openfoodfacts.org/product/3017620422003");
});

test("parseProduct ignores unknown grades and missing code", () => {
  assert.equal(parseProduct({ product_name: "x" }), null);
  const p = parseProduct({ code: "1", nutriscore_grade: "unknown", nova_group: "unknown", ecoscore_grade: "not-applicable" });
  assert.ok(p);
  assert.equal(p.nutriscore, null);
  assert.equal(p.nova, null);
  assert.equal(p.green, null);
});

test("offFactsLine summarises grades", () => {
  assert.equal(offFactsLine({ nutriscore: "c", nova: 4, green: "a-plus" }), "Nutri-Score C, NOVA group 4 of 4, Green-Score A+");
  assert.equal(offFactsLine(null), null);
});
