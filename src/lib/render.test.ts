import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, captionChunks } from "./captions.ts";
import { ringPixels, ringPng } from "./ring.ts";
import { assignSources, planSegments } from "./timeline.ts";
import { buildFfmpegArgs, isRenderStale, parseProgressSeconds, runFfmpeg } from "./render.ts";
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
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:03\.00,RingScore,,0,0,0,,\{\\an5\\pos\(540,300\)\}42/);
  assert.doesNotMatch(buildAss({ words: [], duration: 1, fontName: "x" }), /RingScore,,/);
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

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("real render: clip + still + captions -> 1080x1920 mp4", { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "render-test-"));
  try {
    const run = (a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a]);
    run(["-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24:duration=5", "-pix_fmt", "yuv420p", join(dir, "clip.mp4")]);
    run(["-f", "lavfi", "-i", "testsrc2=size=1000x1000", "-frames:v", "1", join(dir, "photo.jpg")]);

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
    writeFileSync(join(dir, "c.ass"), buildAss({ words: w, duration: seconds, fontName: "DejaVu Sans", score: 42 }));
    writeFileSync(join(dir, "ring.png"), ringPng(300, 42, "#facc15"));

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
