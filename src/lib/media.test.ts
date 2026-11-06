import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsFromAlignment } from "./captions.ts";
import { isMock, mockAlignment, silentWav, speechSeconds } from "./mock.ts";
import { estimateCostUsd } from "./pricing.ts";
import { mergeHashtags, normalizeHashtags, parseCopy, AI_NOTE, CTA, OFF_CREDIT } from "./copy.ts";
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
  assert.equal(out.tiktok.description, `Short.\n\n${CTA}\n\n${AI_NOTE}`);
  assert.deepEqual(out.tiktok.hashtags, ["snacks", "labelcheck"]);
  assert.equal(out.instagram.description, `${CTA}\n\n${AI_NOTE}`);
  const withOff = parseCopy('{"tiktok": {"title": "t", "description": "d", "hashtags": []}, "instagram": {"title": "i", "description": "", "hashtags": []}}', true);
  assert.equal(withOff.tiktok.description, `d\n\n${CTA}\n\n${AI_NOTE}\n\n${OFF_CREDIT}`);
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

import { MAX_WORDS, MIN_WORDS, buildPrompt, ensureHook, wordCount, groupFor, parseTone, pickCandidates } from "./script.ts";

const ings = [
  { name: "Water", score: 95, reason: "Hydrating." },
  { name: "Whole grain oats", score: 90, reason: "Fiber-rich whole grain." },
  { name: "Cane sugar", score: 25, reason: "Added sugar." },
  { name: "Wheat flour", score: 48, reason: "Refined flour." },
  { name: "Olive oil", score: 78, reason: "Unsaturated fats." },
  { name: "Red 40", score: 10, reason: "Synthetic dye." },
  { name: "Salt", score: 45, reason: "Sodium." },
  { name: "Palm oil", score: 30, reason: "Saturated fat." },
];

test("groupFor splits at 60 and 40", () => {
  assert.deepEqual([100, 60, 59, 40, 39, 0].map(groupFor), ["good", "good", "fair", "fair", "poor", "poor"]);
});

test("pickCandidates: best greens, worst reds, trivial water skipped", () => {
  const c = pickCandidates(ings);
  assert.deepEqual(c.good.map((x) => x.name), ["Whole grain oats", "Olive oil"]); // water dropped
  assert.deepEqual(c.poor.map((x) => x.name), ["Red 40", "Cane sugar", "Palm oil"]); // worst first
  assert.deepEqual(c.fair.map((x) => x.name), ["Wheat flour", "Salt"]); // label order
  assert.deepEqual(c.counts, { good: 3, fair: 2, poor: 3 }); // counts still include water
  assert.equal(c.poor[0].position, 6);
});

test("prompt: groups and tone in, no numeric scores, ends on a question rule", () => {
  const p = buildPrompt({ productName: "Oat Bar", overall: 52, allergens: [], ingredients: ings, tone: "playful" });
  assert.match(p, /Upbeat, witty/);
  assert.match(p, /GOOD \(green\)[^]*Whole grain oats[^]*FAIR \(yellow\)[^]*Wheat flour[^]*POOR \(red\)[^]*Red 40/);
  assert.match(p, /Do you eat this\?/);
  assert.match(p, /never say or show any numeric score/i);
  assert.doesNotMatch(p, /\/100/);
  assert.doesNotMatch(p, /\b52\b/); // the overall number is never given to the model
  assert.match(p, /a mixed bag/);
});

test("prompt: empty group is shown as none", () => {
  const p = buildPrompt({ productName: null, overall: 90, allergens: [], ingredients: [{ name: "Oats", score: 95, reason: null }] });
  assert.match(p, /POOR \(red\) candidates, worst first:\n\(none\)/);
});

test("ensureHook adds a question only when missing", () => {
  const base = { title: "T", scenes: [{ seconds: 5, visual: "v", voiceover: "Skip the sugary stuff." }] };
  assert.equal(ensureHook(base).scenes[0].voiceover, "Skip the sugary stuff. Do you eat this?");
  const asked = { title: "T", scenes: [{ seconds: 5, visual: "v", voiceover: "Would you still eat this?" }] };
  assert.equal(ensureHook(asked), asked);
  const quoted = { title: "T", scenes: [{ seconds: 5, visual: "v", voiceover: 'Be honest, "do you eat this?"' }] };
  assert.equal(ensureHook(quoted), quoted);
});

test("parseScript keeps valid sections; parseTone falls back", () => {
  const out = parseScript(
    '{"title":"T","scenes":[{"seconds":4,"visual":"a","voiceover":"x","section":"hook"},{"seconds":4,"visual":"b","voiceover":"y","section":"nope"}]}',
  );
  assert.equal(out.scenes[0].section, "hook");
  assert.equal(out.scenes[1].section, undefined);
  assert.equal(parseTone("calm"), "calm");
  assert.equal(parseTone("shouting"), "friendly");
  assert.equal(parseTone(undefined), "friendly");
});

import { speechBody } from "./elevenlabs.ts";
import { DELIVERIES, parseDelivery } from "./delivery.ts";

test("speechBody sends the chosen delivery as ElevenLabs voice settings", () => {
  const natural = speechBody("Hi", "natural", "eleven_multilingual_v2");
  assert.equal(natural.text, "Hi");
  assert.equal(natural.model_id, "eleven_multilingual_v2");
  assert.deepEqual(natural.voice_settings, DELIVERIES.natural.settings);
  const expressive = speechBody("Hi", "expressive");
  assert.ok(expressive.voice_settings.style > natural.voice_settings.style);
  assert.ok(expressive.voice_settings.stability < natural.voice_settings.stability);
  assert.ok(DELIVERIES.steady.settings.stability > natural.voice_settings.stability);
});

test("parseDelivery falls back to natural", () => {
  assert.equal(parseDelivery("steady"), "steady");
  assert.equal(parseDelivery("loud"), "natural");
  assert.equal(parseDelivery(null), "natural");
});

test("script prompt asks for retention hooks at 15s, 35s and the end", () => {
  const p = buildPrompt({ productName: "Oat Bar", overall: 52, allergens: [], ingredients: [{ name: "Oats", score: 95, reason: null }] });
  assert.match(p, /Hook at about 0:15/);
  assert.match(p, /Hook at about 0:35/);
  assert.match(p, /Closing hook/);
  assert.match(p, /final question/);
});

test("script prompt sets a hard 1-minute word budget", () => {
  const p = buildPrompt({ productName: "Oat Bar", overall: 52, allergens: [], ingredients: [{ name: "Oats", score: 95, reason: null }] });
  assert.match(p, new RegExp(`between ${MIN_WORDS} and ${MAX_WORDS} words`));
  assert.match(p, /55-62/);
  assert.equal(wordCount({ title: "t", scenes: [{ seconds: 5, visual: "v", voiceover: "one two three" }, { seconds: 5, visual: "v", voiceover: "four five" }] }), 5);
});
