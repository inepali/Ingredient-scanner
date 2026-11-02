import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsFromAlignment } from "./captions.ts";
import { isMock, mockAlignment, silentWav, speechSeconds } from "./mock.ts";
import { estimateCostUsd } from "./pricing.ts";
import { mergeHashtags, normalizeHashtags, parseCopy, AI_NOTE } from "./copy.ts";
import { narration, parseScript } from "./script.ts";

test("wordsFromAlignment groups characters into timed words", () => {
  const chars = [..."Hi there"];
  const words = wordsFromAlignment({
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.1),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.1),
  });
  assert.equal(words.length, 2);
  assert.equal(words[0].text, "Hi");
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 0.2) < 1e-9);
  assert.equal(words[1].text, "there");
  assert.ok(Math.abs(words[1].start - 0.3) < 1e-9);
  assert.ok(Math.abs(words[1].end - 0.8) < 1e-9);
});

test("wordsFromAlignment ignores repeated and trailing spaces", () => {
  const chars = [..."a  b "];
  const words = wordsFromAlignment({
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i),
    character_end_times_seconds: chars.map((_, i) => i + 1),
  });
  assert.deepEqual(words.map((w) => w.text), ["a", "b"]);
});

test("mock audio is a valid silent WAV of the right length", () => {
  const wav = silentWav(2);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.length, 44 + 2 * 8000 * 2);
  assert.equal(wav.readUInt32LE(40), 2 * 8000 * 2);
  assert.ok(wav.subarray(44).every((b) => b === 0));
});

test("mock alignment spans the duration and yields one word per word", () => {
  const text = "Hello big world";
  const a = mockAlignment(text, 3);
  assert.equal(a.characters.length, text.length);
  assert.ok(Math.abs(a.character_end_times_seconds.at(-1)! - 3) < 1e-9);
  assert.equal(wordsFromAlignment(a).length, 3);
});

test("speechSeconds is about 2.5 words per second", () => {
  assert.equal(speechSeconds("one two three four five six seven eight nine ten"), 4);
  assert.equal(speechSeconds(""), 1);
});

test("isMock reads MOCK_AI", () => {
  const before = process.env.MOCK_AI;
  process.env.MOCK_AI = "true";
  assert.equal(isMock(), true);
  process.env.MOCK_AI = "false";
  assert.equal(isMock(), false);
  if (before === undefined) delete process.env.MOCK_AI;
  else process.env.MOCK_AI = before;
});

test("estimateCostUsd matches Wan 2.5 pricing", () => {
  assert.equal(estimateCostUsd("480p", 4), 1);
  assert.equal(estimateCostUsd("720p", 4), 2);
  assert.equal(estimateCostUsd("1080p", 1), 0.75);
  assert.equal(estimateCostUsd("480p", 0), 0);
});

test("normalizeHashtags cleans and dedupes", () => {
  assert.deepEqual(normalizeHashtags(["#Healthy Eating", "healthyeating", "Food!", 5, ""]), [
    "healthyeating",
    "food",
  ]);
  assert.deepEqual(normalizeHashtags("nope"), []);
});

test("mergeHashtags puts up to 3 curated tags first and caps the total", () => {
  const merged = mergeHashtags(["a", "b", "c", "d", "e", "f"], ["x", "y", "z", "w"], 8);
  assert.deepEqual(merged, ["x", "y", "z", "a", "b", "c", "d", "e"]);
});

test("parseCopy truncates, cleans hashtags and appends the AI note", () => {
  const out = parseCopy(
    '```json\n{"tiktok": {"title": "' + "T".repeat(150) + '", "description": "Short.", "hashtags": ["#Snacks", "snacks", "Label Check"]}, ' +
      '"instagram": {"title": "Ig", "description": "", "hashtags": []}}\n```',
  );
  assert.equal(out.tiktok.title.length, 100);
  assert.equal(out.tiktok.description, `Short.\n\n${AI_NOTE}`);
  assert.deepEqual(out.tiktok.hashtags, ["snacks", "labelcheck"]);
  assert.equal(out.instagram.description, AI_NOTE);
});

test("parseCopy rejects non-JSON", () => {
  assert.throws(() => parseCopy("no json here"));
});

test("narration joins every scene voiceover in order", () => {
  const script = parseScript(
    '{"title": "T", "scenes": [{"seconds": 5, "visual": "v1", "voiceover": "Hello there."},' +
      ' {"seconds": 5, "visual": "v2", "voiceover": "  Score is 42.  "}]}',
  );
  assert.equal(narration(script), "Hello there. Score is 42.");
});

import { parseVoices } from "./elevenlabs.ts";

test("parseVoices puts free default voices first and labels them", () => {
  const voices = parseVoices({
    voices: [
      { voice_id: "b", name: "Zed", category: "professional", labels: { accent: "british" } },
      { voice_id: "a", name: "Sarah", category: "premade", labels: { gender: "female", accent: "american" } },
      { name: "no id" },
    ],
  });
  assert.deepEqual(voices.map((v) => [v.name, v.free]), [["Sarah", true], ["Zed", false]]);
  assert.equal(voices[0].description, "female, american");
  assert.deepEqual(parseVoices(null), []);
});
