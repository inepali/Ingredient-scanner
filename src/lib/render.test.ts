import { badgeCardPng, badgeCards, badgeTimes } from "./badges.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, captionChunks } from "./captions.ts";
import { ringPixels, ringPng } from "./ring.ts";
import { assignSources, planFootage, planSegments } from "./timeline.ts";
import { buildFfmpegArgs, isRenderStale, parseDuration, parseProgressSeconds, probeDuration, runFfmpeg, RING_CENTER } from "./render.ts";
import { parseReveal, revealSeconds } from "./reveal.ts";
import { mockAlignment, silentWav } from "./mock.ts";
import { wordsFromAlignment } from "./captions.ts";

const words = (text: string, perWord = 0.4) =>
  text.split(" ").map((t, i) => ({ text: t, start: i * perWord, end: i * perWord + perWord - 0.05 }));

test("captionChunks: max 4 words, breaks at sentence ends, holds until the next line", () => {
  const chunks = captionChunks(words("One two three four five. Six seven"));
  assert.deepEqual(chunks.map((c) => c.text), ["One two three four", "five.", "Six seven"]);
  assert.ok(chunks[0].end >= chunks[1].start - 1e-9);
});

test("buildAss has styles, timed captions and the ring score number", () => {
  const ass = buildAss({ words: words("Hello there friend"), duration: 3, fontName: "DejaVu Sans", score: 42 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,.*Caption,,0,0,0,,HELLO THERE FRIEND/);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:03\.00,RingScore,,0,0,0,,\{\\an5\\pos\(540,400\)\}42/);
  assert.match(ass, /RingLabel,,0,0,0,,\{\\an5\\pos\(540,320\)\}HEALTHY/);
  assert.match(ass, /RingLabel,,0,0,0,,\{\\an5\\pos\(540,480\)\}SCORE/);
  assert.doesNotMatch(buildAss({ words: [], duration: 1, fontName: "x" }), /RingScore,,|RingLabel,,/);
});

test("planSegments follows the spoken words", () => {
  const scenes = [
    { seconds: 5, voiceover: "one two three", photo: 1 },
    { seconds: 5, voiceover: "four five", photo: 2 },
    { seconds: 5, voiceover: "six seven eight nine" },
  ];
  const segs = planSegments(scenes, words("one two three four five six seven eight nine", 1), 9);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 3], [3, 5], [5, 9]]);
  assert.deepEqual(segs.map((s) => s.photoNumber), [1, 2, null]);
});

test("planSegments falls back to scaling scene seconds when words don't match", () => {
  const scenes = [
    { seconds: 10, voiceover: "a b" },
    { seconds: 30, voiceover: "c d" },
  ];
  const segs = planSegments(scenes, [], 20);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 5], [5, 20]]);
});

test("planSegments merges scenes that would flash by", () => {
  const scenes = [
    { seconds: 5, voiceover: "a b c" },
    { seconds: 1, voiceover: "d" },
    { seconds: 5, voiceover: "e f g" },
  ];
  const starts = [0, 1, 2, 3, 3.4, 4.4, 5.4];
  const segs = planSegments(scenes, starts.map((s) => ({ start: s, end: s + 0.3 })), 7);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 3.4], [3.4, 7]]);
});

test("assignSources: named photo wins, clip beats still, others rotate", () => {
  const photos = [
    { number: 1, photoPath: "p1.jpg", clipPath: "c1.mp4", clipIsVideo: true },
    { number: 2, photoPath: "p2.jpg", clipPath: null, clipIsVideo: false },
  ];
  const out = assignSources(
    [
      { start: 0, end: 2, photoNumber: 2 },
      { start: 2, end: 4, photoNumber: null },
      { start: 4, end: 6, photoNumber: null },
    ],
    photos,
  );
  assert.deepEqual(out[0].source, { kind: "image", path: "p2.jpg" });
  assert.deepEqual(out[1].source, { kind: "video", path: "c1.mp4" });
  assert.notEqual(out[1].source.path, out[2].source.path); // no repeat back to back
});

test("buildFfmpegArgs targets 1080x1920 H.264 with the voiceover mapped", () => {
  const args = buildFfmpegArgs({
    segments: [
      { kind: "video", file: "a.mp4", duration: 3 },
      { kind: "image", file: "b.jpg", duration: 2 },
    ],
    audioFile: "v.mp3",
    assFile: "/tmp/x/c.ass",
    fontsDir: "/tmp/x/fonts",
    outFile: "out.mp4",
    total: 5,
  });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /concat=n=2/);
  assert.match(graph, /zoompan/);
  assert.match(graph, /ass='\/tmp\/x\/c\.ass'/);
  assert.ok(args.includes("libx264"));
  assert.equal(args[args.indexOf("-map", args.indexOf("[vout]")) + 1], "2:a");
});

test("badges: only known metrics get a chip, in order, coloured by value", () => {
  assert.deepEqual(badgeCards({ nova: null, nutriscore: null, green: null }), []);
  const cards = badgeCards({ nova: 3, green: "a-plus" });
  assert.deepEqual(cards.map((c) => c.title), ["NOVA", "GREEN-SCORE"]);
  assert.ok(cards[0].y < cards[1].y && cards[0].x === cards[1].x); // stacked top to bottom on the left
  assert.equal(cards[0].label, "3");
  assert.equal(cards[0].color, "#EE8100");
  assert.equal(cards[1].label, "A+");
  const all = badgeCards({ nova: 1, nutriscore: "e", green: "d" });
  assert.deepEqual(all.map((c) => c.title), ["NOVA", "NUTRI-SCORE", "GREEN-SCORE"]);
  assert.equal(all[1].color, "#E63E11");
  const ass = buildAss({ words: [], duration: 5, fontName: "X", badges: { nova: 4, nutriscore: "a", green: null } });
  assert.match(ass, /BadgeTitle,,0,0,0,,.*NOVA/);
  assert.match(ass, /BadgeTitle,,0,0,0,,.*NUTRI-SCORE/);
  assert.match(ass, /Ultra-processed/);
  assert.doesNotMatch(ass, /GREEN-SCORE/);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("real render: clip + still + captions -> 1080x1920 mp4", { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "render-test-"));
  try {
    const run = (a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a]);
    run(["-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24:duration=5", "-pix_fmt", "yuv420p", join(dir, "clip.mp4")]);
    run(["-f", "lavfi", "-i", "testsrc2=size=1000x1000", "-frames:v", "1", join(dir, "photo.jpg")]);

    const badges = { nova: 4 as const, nutriscore: "d" as const, green: "b" as const };
    const text = "This snack scores forty two out of one hundred. Sugar comes first. Skip it.";
    const seconds = 9;
    writeFileSync(join(dir, "voice.wav"), silentWav(seconds));
    const w = wordsFromAlignment(mockAlignment(text, seconds));
    const scenes = [
      { seconds: 4, voiceover: "This snack scores forty two out of one hundred.", photo: 1 },
      { seconds: 3, voiceover: "Sugar comes first.", photo: 2 },
      { seconds: 2, voiceover: "Skip it." },
    ];
    const segs = assignSources(planSegments(scenes, w, seconds), [
      { number: 1, photoPath: join(dir, "photo.jpg"), clipPath: join(dir, "clip.mp4"), clipIsVideo: true },
      { number: 2, photoPath: join(dir, "photo.jpg"), clipPath: null, clipIsVideo: false },
    ]);
    writeFileSync(join(dir, "c.ass"), buildAss({ words: w, duration: seconds, fontName: "DejaVu Sans", score: 42, ringCenter: RING_CENTER, revealAt: 5, badges, badgeAt: [2, 4, 6] }));
    writeFileSync(join(dir, "ring.png"), ringPng(380, 42, "#facc15"));
    writeFileSync(join(dir, "ring0.png"), ringPng(380, 0, "#3b82f6"));
    const cardList = badgeCards(badges);
    const badgeFiles = cardList.map((c, i) => {
      writeFileSync(join(dir, `b${i}.png`), badgeCardPng(c));
      return { file: join(dir, `b${i}.png`), x: c.x, y: c.y, at: [2, 4, 6][i] };
    });

    const out = join(dir, "out.mp4");
    const progress: number[] = [];
    await runFfmpeg(
      buildFfmpegArgs({
        segments: segs.map((s) => ({ kind: s.source.kind, file: s.source.path, duration: s.end - s.start })),
        audioFile: join(dir, "voice.wav"),
        assFile: join(dir, "c.ass"),
        fontsDir: join(process.cwd(), "assets/fonts"),
        outFile: out,
        ringFile: join(dir, "ring.png"),
        ringBlankFile: join(dir, "ring0.png"),
        badges: badgeFiles,
        revealAt: 5,
        total: seconds,
        preset: "ultrafast",
      }),
      "ffmpeg",
      (sec) => progress.push(sec),
    );
    assert.ok(progress.length > 0, "progress callback never fired");
    assert.ok(progress[progress.length - 1] > seconds - 1, `last progress ${progress[progress.length - 1]}`);
    assert.deepEqual([...progress].sort((a, b) => a - b), progress);

    if (process.env.KEEP_RENDER) writeFileSync(process.env.KEEP_RENDER, readFileSync(out));
    const probe = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "json", out]).toString(),
    );
    const v = probe.streams.find((s: { codec_name: string }) => s.codec_name === "h264");
    assert.equal(v.width, 1080);
    assert.equal(v.height, 1920);
    assert.ok(probe.streams.some((s: { codec_name: string }) => s.codec_name === "aac"));
    assert.ok(Math.abs(Number(probe.format.duration) - seconds) < 0.3, `duration ${probe.format.duration}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseProgressSeconds reads the latest out_time_us", () => {
  assert.equal(parseProgressSeconds("frame=10\nout_time_us=1500000\nprogress=continue\nout_time_us=2500000\n"), 2.5);
  assert.equal(parseProgressSeconds("frame=10\nprogress=continue\n"), null);
});

test("isRenderStale uses the heartbeat, falling back to created_at", () => {
  const now = Date.parse("2026-11-02T12:10:00Z");
  const base = { status: "running", created_at: "2026-11-02T12:00:00Z" };
  assert.equal(isRenderStale(base, now), true); // no heartbeat for 10 minutes
  assert.equal(isRenderStale({ ...base, output: { heartbeat: "2026-11-02T12:09:30Z" } }, now), false);
  assert.equal(isRenderStale({ ...base, output: { heartbeat: "2026-11-02T12:05:00Z" } }, now), true);
  assert.equal(isRenderStale({ ...base, status: "done" }, now), false);
  assert.equal(isRenderStale({ status: "running", created_at: "2026-11-02T12:09:00Z" }, now), false);
});

test("ffmpegPath skips a bad FFMPEG_PATH and finds a working ffmpeg", { skip: !hasFfmpeg }, async () => {
  const { ffmpegPath } = await import("./render.ts");
  process.env.FFMPEG_PATH = "/definitely/not/here/ffmpeg";
  try {
    const found = await ffmpegPath();
    assert.notEqual(found, "/definitely/not/here/ffmpeg");
    assert.equal(spawnSync(found, ["-version"]).status, 0);
  } finally {
    delete process.env.FFMPEG_PATH;
  }
});

test("score ring: coloured arc clockwise from the top, grey track for the rest", () => {
  const size = 264;
  const px = ringPixels(size, 32, "#f97316");
  const at = (x: number, y: number) => [...px.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const c = size / 2;
  const r = (54 / 132) * size;
  assert.deepEqual(at(c, Math.round(c - r)).slice(0, 3), [249, 115, 22]); // top: arc starts here
  assert.deepEqual(at(Math.round(c + r), c).slice(0, 3), [249, 115, 22]); // 3 o'clock: inside 32%? 25% yes
  assert.deepEqual(at(c, Math.round(c + r)).slice(0, 3), [229, 229, 229]); // bottom: track
  assert.deepEqual(at(Math.round(c - r), c).slice(0, 3), [229, 229, 229]); // 9 o'clock: track
  assert.equal(at(c, c)[3], Math.round(0.94 * 255)); // white disc behind the number
  assert.equal(at(1, 1)[3], 0); // corners stay transparent
  const png = ringPng(60, 100, "#16a34a");
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
});

test("planFootage: keeps order and everything when footage is long enough", () => {
  const p = planFootage([10, 20, 15], 30);
  assert.equal(p.mode, "as-is");
  assert.deepEqual(p.parts.map((x) => [x.index, x.speed, x.duration]), [[0, 1, 10], [1, 1, 20], [2, 1, 15]]);
  assert.equal(p.total, 45); // runs past the narration; nothing is cut
});

test("planFootage: slows evenly (not below half speed) when footage is short", () => {
  const p = planFootage([10, 10], 30); // needs 1.5x longer
  assert.equal(p.mode, "slowed");
  assert.ok(p.parts.every((x) => Math.abs(x.speed - 1 / 1.5) < 1e-9 && Math.abs(x.duration - 15) < 1e-9));
  assert.equal(p.total, 30);
  const half = planFootage([10, 5], 30); // exactly 2x
  assert.equal(half.mode, "slowed");
  assert.ok(half.parts.every((x) => Math.abs(x.speed - 0.5) < 1e-9));
});

test("planFootage: repeats the sequence at half speed when even that is too short", () => {
  const p = planFootage([4, 6], 60); // 20 s at half speed, needs 60
  assert.equal(p.mode, "slowed-and-repeated");
  assert.deepEqual(p.parts.map((x) => x.index), [0, 1, 0, 1, 0, 1].slice(0, p.parts.length));
  assert.ok(p.parts.every((x) => x.speed === 0.5));
  const sum = p.parts.reduce((a, b) => a + b.duration, 0);
  assert.ok(Math.abs(sum - 60) < 1e-6 && p.total === 60);
  assert.deepEqual(planFootage([], 30).parts, []);
});

test("parseDuration reads ffmpeg's banner", () => {
  assert.equal(parseDuration("  Duration: 00:01:02.50, start: 0.0"), 62.5);
  assert.equal(parseDuration("nothing"), null);
});

test("real render: two uploads (landscape + portrait) merged whole, slowed, nothing cropped", { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "footage-test-"));
  try {
    const run = (a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a]);
    run(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=3", "-pix_fmt", "yuv420p", join(dir, "a.mp4")]); // landscape
    run(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24:duration=3", "-pix_fmt", "yuv420p", join(dir, "b.mp4")]); // portrait
    const lens = [await probeDuration(join(dir, "a.mp4"), "ffmpeg"), await probeDuration(join(dir, "b.mp4"), "ffmpeg")];
    assert.ok(lens.every((l) => l !== null && Math.abs(l - 3) < 0.2), String(lens));

    const audioSeconds = 9; // footage is 6 s: slowed to 0.67x
    writeFileSync(join(dir, "voice.wav"), silentWav(audioSeconds));
    writeFileSync(join(dir, "c.ass"), buildAss({ words: [], duration: audioSeconds, fontName: "DejaVu Sans", score: 30 }));
    const plan = planFootage(lens as number[], audioSeconds);
    const out = join(dir, "out.mp4");
    await runFfmpeg(
      buildFfmpegArgs({
        segments: plan.parts.map((p) => ({ kind: "video" as const, file: join(dir, p.index === 0 ? "a.mp4" : "b.mp4"), duration: p.duration, speed: p.speed, fit: "blur" as const })),
        audioFile: join(dir, "voice.wav"),
        assFile: join(dir, "c.ass"),
        fontsDir: join(process.cwd(), "assets/fonts"),
        outFile: out,
        audioSeconds,
        total: plan.total,
        preset: "ultrafast",
      }),
      "ffmpeg",
    );
    const d = await probeDuration(out, "ffmpeg");
    assert.ok(d !== null && Math.abs(d - 9) < 0.4, `duration ${d}`);

    // Longer footage than narration: video runs past the voice, audio is padded, nothing is trimmed.
    const long = planFootage(lens as number[], 4); // 6 s footage > 4 s voice
    writeFileSync(join(dir, "voice4.wav"), silentWav(4));
    const out2 = join(dir, "out2.mp4");
    await runFfmpeg(
      buildFfmpegArgs({
        segments: long.parts.map((p) => ({ kind: "video" as const, file: join(dir, p.index === 0 ? "a.mp4" : "b.mp4"), duration: p.duration, speed: p.speed, fit: "blur" as const })),
        audioFile: join(dir, "voice4.wav"),
        assFile: join(dir, "c.ass"),
        fontsDir: join(process.cwd(), "assets/fonts"),
        outFile: out2,
        audioSeconds: 4,
        total: long.total,
        preset: "ultrafast",
      }),
      "ffmpeg",
    );
    const d2 = await probeDuration(out2, "ffmpeg");
    assert.ok(d2 !== null && Math.abs(d2 - 6) < 0.4, `duration ${d2}`);
    if (process.env.KEEP_FOOTAGE) writeFileSync(process.env.KEEP_FOOTAGE, readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reveal: ring shows ? first, badges follow the narration", () => {
  assert.equal(revealSeconds("start", 60), 0);
  assert.equal(revealSeconds("15", 60), 15);
  assert.equal(revealSeconds("end", 60), 50);
  assert.equal(revealSeconds("25", 20), 16); // short video: still leaves 4 s on screen
  assert.equal(parseReveal("nonsense"), "15");

  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  const words = [w("It", 1), w("is", 1.3), w("NOVA", 3), w("group", 3.4), w("4.", 3.8), w("Nutri-Score", 8), w("D.", 8.5), w("Green", 20), w("score", 20.3), w("B.", 20.6), w("green", 30), w("beans", 30.3)];
  const badges = { nova: 4 as const, nutriscore: "d" as const, green: "b" as const };
  const at = badgeTimes(badges, words, 15);
  assert.deepEqual(at.map((t) => Math.round(t * 10) / 10), [2.9, 7.9, 19.9]);
  assert.deepEqual(badgeTimes({ nova: 2, nutriscore: null, green: null }, [w("hello", 1)], 15), [15]); // never spoken -> fallback

  const ass = buildAss({ words, duration: 60, fontName: "X", score: 42, revealAt: 15, badges });
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:15\.00,RingScore,,0,0,0,,\{[^}]*\}\?/);
  assert.match(ass, /Dialogue: 1,0:00:15\.00,0:01:00\.00,RingScore,,0,0,0,,\{[^}]*\}42/);
  const spin = ass.split("\n").find((l) => l.includes(",Spin,,"))!;
  assert.ok((spin.match(/\\1c&H/g) ?? []).length > 10, "spinner should hop between colours");
  assert.match(spin, /\\1c&H[0-9A-F]{6}&\)\\t\(0,15000/); // last colour change is before the rotation tag
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:15\.00,Spin,,0,0,0,,\{[^}]*\\t\(0,15000,\\frz-\d+\)[^}]*\\p1\}m /);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:01:00\.00,RingLabel/);
  assert.match(ass, /Dialogue: 2,0:00:02\.85,0:01:00\.00,BadgeLetter/);
  assert.match(ass, /Dialogue: 2,0:00:07\.85,0:01:00\.00,BadgeLetter/);

  const args = buildFfmpegArgs({
    segments: [{ kind: "image", file: "a.jpg", duration: 5 }],
    audioFile: "a.mp3", assFile: "c.ass", fontsDir: "f", outFile: "o.mp4",
    ringFile: "ring.png", ringBlankFile: "ring0.png", revealAt: 15, total: 5,
    badges: [{ file: "b0.png", x: 40, y: 1325, at: 2.85 }],
  });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /overlay=\d+:250:enable=lt\(t\\,15\.00\)\[vq\]/);
  assert.match(graph, /overlay=\d+:250:enable=gte\(t\\,15\.00\)\[vr\]/);
  assert.match(graph, /overlay=40:1325:enable=gte\(t\\,2\.85\)\[vb0\]/);
  const now = buildFfmpegArgs({ segments: [{ kind: "image", file: "a.jpg", duration: 5 }], audioFile: "a.mp3", assFile: "c.ass", fontsDir: "f", outFile: "o.mp4", ringFile: "ring.png", total: 5 });
  assert.doesNotMatch(now[now.indexOf("-filter_complex") + 1], /enable=/);
});
