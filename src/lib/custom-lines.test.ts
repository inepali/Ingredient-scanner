import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLines, withCustomLines } from "./custom-lines.ts";
import { narration, parseScript, type VideoScript } from "./script.ts";

const base: VideoScript = {
  title: "T",
  scenes: ["a1", "a2", "a3", "a4", "Do you eat this?"].map((v, i) => ({ seconds: 8, visual: `v${i}`, voiceover: v })),
};

test("cleanLines trims, defaults the position and drops empties", () => {
  const out = cleanLines([
    { text: "  Hello   world ", position: "middle" },
    { text: "", position: "start" },
    { text: "x", position: "nowhere", enabled: false },
    "junk",
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "Hello world");
  assert.equal(out[0].position, "middle");
  assert.equal(out[1].position, "start");
  assert.equal(out[1].enabled, false);
  assert.notEqual(out[0].id, out[1].id);
  assert.deepEqual(cleanLines("nope"), []);
});

test("custom lines land at start, middle and just before the closing question", () => {
  const lines = cleanLines([
    { text: "S", position: "start" },
    { text: "M", position: "middle" },
    { text: "E", position: "end" },
    { text: "OFF", position: "start", enabled: false },
  ]);
  assert.equal(narration(withCustomLines(base, lines)), "S a1 a2 a3 M a4 E Do you eat this?");
});

test("applying lines again replaces the earlier ones and survives a save and reload", () => {
  const once = withCustomLines(base, cleanLines([{ text: "S", position: "start" }]));
  const reloaded = parseScript(JSON.stringify(once));
  assert.equal(reloaded.scenes[0].custom, true);
  const twice = withCustomLines(reloaded, cleanLines([{ text: "Z", position: "end" }]));
  assert.equal(narration(twice), "a1 a2 a3 a4 Z Do you eat this?");
  assert.equal(narration(withCustomLines(twice, [])), narration(base));
});
