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
  const { scanId, media, hasScript, audioUrl, audioSeconds, copy, pendingJobs, maxClips, mock } = props;
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolution, setResolution] = useState<"480p" | "720p">(props.defaultResolution);

  // While clips are rendering, poll their jobs; refresh the page data when any finishes.
  const pendingKey = pendingJobs.map((j) => j.id).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    const timer = setInterval(async () => {
      try {
        const results = await Promise.all(ids.map((id) => call<{ status: string }>(`/api/jobs/${id}`)));
        if (results.some((r) => r.status !== "running")) router.refresh();
      } catch {
        // transient error; keep polling
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [pendingKey, router]);

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
        <h3 className="font-medium">1. Post copy</h3>
        <p className="text-sm text-neutral-500">Title, description and hashtags for TikTok and Instagram.</p>
        <button
          className={btn}
          disabled={busy !== null}
          onClick={() =>
            run("copy", async () => {
              await postJson(`/api/scans/${scanId}/copy`, {});
              return "Post copy written.";
            })
          }
        >
          {busy === "copy" ? "Writing…" : copy.length > 0 ? "Rewrite post copy" : "Write post copy"}
        </button>

        {copy.map((c) => (
          <div key={c.platform} className="space-y-1 rounded-md bg-neutral-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <strong className="capitalize">{c.platform}</strong>
              <button
                className="text-xs underline"
                onClick={() => {
                  const tags = c.hashtags.map((h) => `#${h}`).join(" ");
                  void navigator.clipboard
                    .writeText(`${c.title}\n\n${c.description}\n\n${tags}`)
                    .then(() => setNotice(`${c.platform} copy copied.`));
                }}
              >
                Copy
              </button>
            </div>
            <p className="font-medium">{c.title}</p>
            <p className="whitespace-pre-wrap text-neutral-600">{c.description}</p>
            <p className="text-neutral-500">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>
          </div>
        ))}
      </section>

      <section className={card}>
        <h3 className="font-medium">2. AI voice</h3>
        <button
          className={btn}
          disabled={busy !== null || !hasScript}
          onClick={() =>
            run("voice", async () => {
              const r = await postJson<{ characters: number; warning: string | null; mock: boolean }>(
                `/api/scans/${scanId}/voice`,
                {},
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
        <h3 className="font-medium">3. Animated clips (Wan 2.5)</h3>
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
    </div>
  );
}
