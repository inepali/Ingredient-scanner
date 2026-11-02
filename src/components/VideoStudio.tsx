"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CLIP_SECONDS, PRICE_PER_SECOND, estimateCostUsd, type Resolution } from "@/lib/pricing";

export type StudioMedia = {
  id: string;
  kind: "product_image" | "clip";
  url: string;
  source_media_id: string | null;
  is_video: boolean;
};

export type StudioCopy = {
  platform: "tiktok" | "instagram";
  title: string;
  description: string;
  hashtags: string[];
};

export type StudioProps = {
  scanId: string;
  media: StudioMedia[];
  hasScript: boolean;
  audioUrl: string | null;
  audioSeconds: number | null;
  videoUrl: string | null;
  downloadUrl: string | null;
  renderJobId: string | null;
  renderError: string | null;
  renderStartedAt: string | null;
  renderProgress: { stage?: string; percent?: number } | null;
  copy: StudioCopy[];
  pendingJobs: { id: string; media_id: string | null }[];
  maxClips: number;
  defaultResolution: "480p" | "720p";
  mock: boolean;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // non-JSON body; fall through to the status message
  }
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Server error (HTTP ${res.status}).`);
  }
  return data as T;
}

function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return call<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const btn =
  "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40";
const card = "space-y-3 rounded-xl border bg-white p-4";

export default function VideoStudio(props: StudioProps) {
  const { scanId, media, hasScript, audioUrl, audioSeconds, copy, pendingJobs, maxClips, mock, videoUrl, downloadUrl, renderJobId, renderError, renderStartedAt } = props;
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string; free: boolean; description: string | null }[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage?: string; percent?: number } | null>(props.renderProgress);
  const [now, setNow] = useState(() => Date.now());
  const [drafts, setDrafts] = useState<Record<string, { title: string; description: string; tags: string }>>({});
  const [resolution, setResolution] = useState<"480p" | "720p">(props.defaultResolution);

  useEffect(() => {
    call<{ voices: typeof voices; selected: string }>("/api/voices")
      .then((r) => {
        setVoices(r.voices);
        setVoiceId(r.selected);
      })
      .catch((e) => setVoiceError(e instanceof Error ? e.message : "Could not load voices."));
  }, []);

  useEffect(() => setProgress(props.renderProgress), [props.renderProgress]);

  // Fresh edit boxes whenever the saved copy changes.
  const copyKey = JSON.stringify(copy);
  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        copy.map((c) => [c.platform, { title: c.title, description: c.description, tags: c.hashtags.map((h) => `#${h}`).join(" ") }]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyKey]);

  // Poll running jobs: clips every 4 s, the render every 2 s (it also feeds the progress bar).
  const clipKey = pendingJobs.map((j) => j.id).join(",");
  useEffect(() => {
    if (!clipKey && !renderJobId) return;
    const clipIds = clipKey ? clipKey.split(",") : [];
    const timer = setInterval(async () => {
      setNow(Date.now());
      try {
        const results = await Promise.all([
          ...clipIds.map((id) => call<{ status: string }>(`/api/jobs/${id}`)),
          ...(renderJobId
            ? [call<{ status: string; progress?: { stage?: string; percent?: number } | null }>(`/api/jobs/${renderJobId}`)]
            : []),
        ]);
        const render = renderJobId ? results[results.length - 1] : null;
        if (render && "progress" in render && render.progress) setProgress(render.progress);
        if (results.some((r) => r.status !== "running")) router.refresh();
      } catch {
        // transient error; keep polling
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [clipKey, renderJobId, router]);

  async function run(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const photos = media.filter((m) => m.kind === "product_image");
  const clips = media.filter((m) => m.kind === "clip");
  const clipBySource = new Map(clips.map((c) => [c.source_media_id, c]));
  const pendingSources = new Set(pendingJobs.map((j) => j.media_id));
  const unanimated = photos.filter((p) => !clipBySource.has(p.id) && !pendingSources.has(p.id));
  const slots = Math.max(0, maxClips - clips.length - pendingJobs.length);
  const toAnimate = Math.min(slots, unanimated.length);
  const cost = mock ? 0 : estimateCostUsd(resolution as Resolution, toAnimate);

  const elapsed = renderStartedAt ? Math.max(0, Math.round((now - new Date(renderStartedAt).getTime()) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const percent = progress?.percent ?? 0;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Make the video</h2>

      {mock && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Mock mode is on: voice is silent and clips reuse your photos. Nothing paid is called.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className={card}>
        <h3 className="font-medium">1. AI voice</h3>
        {voices.length > 0 && (
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-500">Voice</span>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              disabled={busy !== null}
              className="w-full rounded-md border px-2 py-2"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.description ? ` · ${v.description}` : ""}
                  {v.free ? "" : " (paid plan only)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {voiceError && <p className="text-xs text-amber-700">{voiceError}</p>}
        <button
          className={btn}
          disabled={busy !== null || !hasScript}
          onClick={() =>
            run("voice", async () => {
              const r = await postJson<{ characters: number; warning: string | null; mock: boolean }>(
                `/api/scans/${scanId}/voice`,
                voiceId ? { voice_id: voiceId } : {},
              );
              return r.warning ?? `Voiceover ready (${r.characters} characters${r.mock ? ", mock" : ""}).`;
            })
          }
        >
          {busy === "voice" ? "Generating voice…" : audioUrl ? "Regenerate voice" : "Generate voice"}
        </button>
        {!hasScript && <p className="text-sm text-neutral-500">Create the video script above first.</p>}
        {audioUrl && (
          <>
            <audio controls src={audioUrl} className="w-full" />
            {audioSeconds !== null && (
              <p className="text-xs text-neutral-500">{audioSeconds.toFixed(1)} seconds</p>
            )}
          </>
        )}
      </section>

      <section className={card}>
        <h3 className="font-medium">2. Animated clips (Wan 2.5)</h3>
        {photos.length === 0 ? (
          <p className="text-sm text-neutral-500">This scan has no product photos. Add them when you start a scan.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => {
                const clip = clipBySource.get(p.id);
                const pending = pendingSources.has(p.id);
                const label = clip ? (clip.is_video ? "Animated" : "Mock clip") : pending ? "Animating…" : "Photo";
                return (
                  <figure key={p.id} className="space-y-1">
                    <div className="aspect-[9/16] overflow-hidden rounded-md bg-neutral-100">
                      {clip?.is_video ? (
                        <video src={clip.url} controls muted loop playsInline className="h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt="Product" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <figcaption className="text-center text-xs text-neutral-500">{label}</figcaption>
                  </figure>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as "480p" | "720p")}
                disabled={busy !== null}
                className="rounded-md border px-2 py-2 text-sm"
              >
                <option value="480p">480p draft (${PRICE_PER_SECOND["480p"].toFixed(2)}/s)</option>
                <option value="720p">720p final (${PRICE_PER_SECOND["720p"].toFixed(2)}/s)</option>
              </select>
              <button
                className={btn}
                disabled={busy !== null || toAnimate === 0}
                onClick={() =>
                  run("footage", async () => {
                    const r = await postJson<{ jobs: unknown[]; estimated_cost_usd: number }>(
                      `/api/scans/${scanId}/footage`,
                      { resolution },
                    );
                    return `Started ${r.jobs.length} clip${r.jobs.length === 1 ? "" : "s"}${
                      mock ? " (mock)" : ` (about $${r.estimated_cost_usd.toFixed(2)})`
                    }. They usually take a couple of minutes.`;
                  })
                }
              >
                {busy === "footage"
                  ? "Starting…"
                  : toAnimate === 0
                    ? "Nothing to animate"
                    : `Animate ${toAnimate} photo${toAnimate === 1 ? "" : "s"}${mock ? "" : ` · ~$${cost.toFixed(2)}`}`}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {CLIP_SECONDS}-second clips, up to {maxClips} per scan.
              {pendingJobs.length > 0 && ` ${pendingJobs.length} rendering now; this page updates itself.`}
            </p>
          </>
        )}
      </section>
      <section className={card}>
        <h3 className="font-medium">3. Final video (1080×1920, 9:16)</h3>
        <p className="text-sm text-neutral-500">
          Puts your clips (or photos with a slow zoom), the voiceover and captions together. No AI video credits are
          used.
          {clips.length === 0 && !renderJobId && " No animated clips yet, so your photos will be used."}
        </p>

        {renderJobId !== null ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{progress?.stage ?? "Starting…"}</span>
              <span className="tabular-nums text-neutral-500">
                {percent}% · {clock}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-neutral-900 transition-all duration-500" style={{ width: `${Math.max(percent, 2)}%` }} />
            </div>
            <p className="text-xs text-neutral-500">
              A 60-second video usually takes under a minute. You can leave this page; it will be here when you
              come back.
            </p>
            <button
              className="rounded-md border px-3 py-1.5 text-sm"
              disabled={busy !== null}
              onClick={() =>
                run("cancel", async () => {
                  await call(`/api/jobs/${renderJobId}`, { method: "DELETE" });
                  return "Render cancelled.";
                })
              }
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className={btn}
            disabled={busy !== null || !audioUrl}
            onClick={() =>
              run("render", async () => {
                setProgress(null);
                await postJson(`/api/scans/${scanId}/render`, {});
              })
            }
          >
            {busy === "render" ? "Starting…" : videoUrl ? "Generate again" : "Generate video"}
          </button>
        )}
        {!audioUrl && <p className="text-sm text-neutral-500">Generate the voice first.</p>}
        {renderError && renderJobId === null && <p className="text-sm text-red-600">{renderError}</p>}

        {videoUrl && renderJobId === null && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Review your video</p>
            <video src={videoUrl} controls playsInline className="aspect-[9/16] w-full max-w-xs rounded-lg bg-black" />
            {downloadUrl && (
              <a href={downloadUrl} className="inline-block rounded-md border px-3 py-1.5 text-sm underline">
                Download MP4
              </a>
            )}
            <p className="text-xs text-neutral-500">
              Not happy? Change the script, voice or clips above and generate again. Source clips are{" "}
              {props.defaultResolution}-quality video scaled up to 1080×1920.
            </p>
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="font-medium">4. Social copy: title, description and tags</h3>
        {!videoUrl ? (
          <p className="text-sm text-neutral-500">Generate and review the video first.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Happy with the video? Write the post text for TikTok and Instagram, then edit it as you like.
            </p>
            <button
              className={btn}
              disabled={busy !== null || renderJobId !== null}
              onClick={() =>
                run("copy", async () => {
                  await postJson(`/api/scans/${scanId}/copy`, {});
                  return "Social copy written. Edit it below, then copy it into the app.";
                })
              }
            >
              {busy === "copy" ? "Writing…" : copy.length > 0 ? "Regenerate" : "Generate social copy"}
            </button>
          </>
        )}

        {copy.map((c) => {
          const d = drafts[c.platform];
          if (!d) return null;
          const saved = d.title === c.title && d.description === c.description && d.tags === c.hashtags.map((h) => `#${h}`).join(" ");
          const tagCount = d.tags.split(/\s+/).filter(Boolean).length;
          const set = (patch: Partial<typeof d>) => setDrafts({ ...drafts, [c.platform]: { ...d, ...patch } });
          return (
            <div key={c.platform} className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong className="capitalize">{c.platform}</strong>
                <button
                  className="text-xs underline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`${d.title}\n\n${d.description}\n\n${d.tags}`)
                      .then(() => setNotice(`${c.platform} copy copied.`))
                  }
                >
                  Copy all
                </button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Title ({d.title.length}/100)</span>
                <input
                  value={d.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className="w-full rounded-md border bg-white px-2 py-1.5"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Description ({d.description.length}/2200)</span>
                <textarea
                  value={d.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={5}
                  className="w-full rounded-md border bg-white px-2 py-1.5"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Hashtags ({tagCount})</span>
                <textarea
                  value={d.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border bg-white px-2 py-1.5"
                />
              </label>
              <button
                className="rounded-md border bg-white px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={busy !== null || saved}
                onClick={() =>
                  run(`save-${c.platform}`, async () => {
                    await postJson(
                      `/api/scans/${scanId}/copy`,
                      { platform: c.platform, title: d.title, description: d.description, hashtags: d.tags.split(/\s+/) },
                      "PATCH",
                    );
                    return `${c.platform} copy saved.`;
                  })
                }
              >
                {saved ? "Saved" : "Save edits"}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
