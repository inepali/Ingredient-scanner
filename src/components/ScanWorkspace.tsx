"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_DELIVERY, DELIVERIES, type Delivery } from "@/lib/delivery";
import { CLIP_SECONDS, PRICE_PER_SECOND, estimateCostUsd, type Resolution } from "@/lib/pricing";

export type StudioMedia = {
  id: string;
  kind: "product_image" | "clip";
  url: string;
  source_media_id: string | null;
  is_video: boolean;
};

export type VoiceTake = {
  id: string;
  number: number;
  voiceName: string;
  delivery: string | null;
  seconds: number | null;
  createdAt: string;
  url: string;
  downloadUrl: string;
  selected: boolean;
  /** Made for the current script (takes for an older script can't be used). */
  usable: boolean;
  mock: boolean;
};

export type StudioCopy = {
  platform: "tiktok" | "instagram";
  title: string;
  description: string;
  hashtags: string[];
};

export type StudioPost = {
  id: string;
  platform: "tiktok" | "instagram";
  status: "processing" | "published" | "failed";
  permalink: string | null;
  error: string | null;
  privacy: string | null;
};

export type StudioSocial = {
  /** APP_PASSWORD is set; connecting and posting are blocked without it. */
  guarded: boolean;
  accounts: { platform: "tiktok" | "instagram"; name: string | null; expired: boolean }[];
  posts: StudioPost[];
};

export type StudioProps = {
  /** Server-rendered panels for the first two tabs. */
  ingredients: ReactNode;
  scriptPanel: ReactNode;
  scanId: string;
  media: StudioMedia[];
  hasScript: boolean;
  audioUrl: string | null;
  audioSeconds: number | null;
  voiceTakes: VoiceTake[];
  videoUrl: string | null;
  downloadUrl: string | null;
  renderJobId: string | null;
  renderError: string | null;
  renderStartedAt: string | null;
  renderProgress: { stage?: string; percent?: number } | null;
  copy: StudioCopy[];
  social: StudioSocial;
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

type TabId = "ingredients" | "script" | "voice" | "animation" | "video" | "social";

const TABS: { id: TabId; label: string }[] = [
  { id: "ingredients", label: "Ingredients" },
  { id: "script", label: "Script" },
  { id: "voice", label: "Voice" },
  { id: "animation", label: "Animation" },
  { id: "video", label: "Final Video" },
  { id: "social", label: "Social" },
];

const btn =
  "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40";
const card = "space-y-3 rounded-xl border bg-white p-4";

export default function ScanWorkspace(props: StudioProps) {
  const { ingredients, scriptPanel, scanId, media, hasScript, audioUrl, voiceTakes, copy, pendingJobs, maxClips, mock, videoUrl, downloadUrl, renderJobId, renderError, renderStartedAt, social } = props;
  const router = useRouter();

  const [tab, setTab] = useState<TabId>("ingredients");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  // Open the tab named in the URL (#voice) after load, so a reload keeps your place.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === id)) setTab(id as TabId);
  }, []);

  function selectTab(id: TabId, focus = false) {
    setTab(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      // not critical
    }
    if (focus) tabRefs.current[id]?.focus();
  }

  function onTabKey(e: KeyboardEvent, index: number) {
    const last = TABS.length - 1;
    const target =
      e.key === "ArrowRight" ? (index + 1) % TABS.length
      : e.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (target === null) return;
    e.preventDefault();
    selectTab(TABS[target].id, true);
  }

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string; free: boolean; description: string | null }[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage?: string; percent?: number } | null>(props.renderProgress);
  const [now, setNow] = useState(() => Date.now());
  const [drafts, setDrafts] = useState<Record<string, { title: string; description: string; tags: string }>>({});
  const [privacy, setPrivacy] = useState("SELF_ONLY");
  const [posts, setPosts] = useState<StudioPost[]>(social.posts);
  useEffect(() => setPosts(social.posts), [social.posts]);

  // Back from a platform's sign-in page: show what happened.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ok = q.get("social_ok");
    const bad = q.get("social_error");
    if (!ok && !bad) return;
    if (ok) setNotice(`${ok}.`);
    if (bad) setError(bad);
    q.delete("social_ok");
    q.delete("social_error");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, []);

  // Check posts the platform is still processing.
  const processingKey = posts.filter((p) => p.status === "processing").map((p) => p.id).join(",");
  useEffect(() => {
    if (!processingKey) return;
    const timer = setInterval(async () => {
      for (const id of processingKey.split(",")) {
        try {
          const r = await call<{ status: StudioPost["status"]; permalink?: string | null; error?: string | null }>(`/api/social/posts/${id}`, { method: "POST" });
          if (r.status !== "processing") {
            setPosts((cur) => cur.map((p) => (p.id === id ? { ...p, status: r.status, permalink: r.permalink ?? null, error: r.error ?? null } : p)));
          }
        } catch {
          // try again next tick
        }
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [processingKey]);

  const [resolution, setResolution] = useState<"480p" | "720p">(props.defaultResolution);

  useEffect(() => {
    call<{ voices: typeof voices; selected: string; warning?: string }>("/api/voices")
      .then((r) => {
        setVoices(r.voices);
        setVoiceId(r.selected);
        if (r.warning) setVoiceError(r.warning);
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

  const tabStatus: Record<TabId, "done" | "busy" | null> = {
    ingredients: null,
    script: hasScript ? "done" : null,
    voice: audioUrl ? "done" : null,
    animation: pendingJobs.length > 0 ? "busy" : clips.length > 0 ? "done" : null,
    video: renderJobId !== null ? "busy" : videoUrl ? "done" : null,
    social: copy.length > 0 ? "done" : null,
  };

  return (
    <div className="space-y-6">
      {mock && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Mock mode is on: voice is silent and clips reuse your photos. Nothing paid is called.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <div role="tablist" aria-label="Scan steps" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {TABS.map((t, i) => {
          const active = tab === t.id;
          const st = tabStatus[t.id];
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                active ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t.label}
              {st === "done" && (
                <span className="text-green-600" aria-label="done">
                  ✓
                </span>
              )}
              {st === "busy" && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-label="in progress" />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="panel-ingredients" aria-labelledby="tab-ingredients" hidden={tab !== "ingredients"} className="space-y-4 pt-4">
        {ingredients}
      </div>
      <div role="tabpanel" id="panel-script" aria-labelledby="tab-script" hidden={tab !== "script"} className="space-y-4 pt-4">
        {scriptPanel}
      </div>
      <div role="tabpanel" id="panel-voice" aria-labelledby="tab-voice" hidden={tab !== "voice"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">{voiceTakes.length > 0 ? "Generate another take" : "AI voice"}</h3>
        <p className="text-sm text-neutral-500">
          Every take is saved, so you can try different voices or delivery and pick the one the video uses.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
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
          {voices.length === 0 && (
            <label className="block space-y-1 text-sm">
              <span className="text-neutral-500">Voice ID</span>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value.trim())}
                placeholder="e.g. from elevenlabs.io > Voices"
                disabled={busy !== null}
                className="w-full rounded-md border px-2 py-2"
              />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-500">Delivery</span>
            <select
              value={delivery}
              onChange={(e) => setDelivery(e.target.value as Delivery)}
              disabled={busy !== null}
              className="w-full rounded-md border px-2 py-2"
            >
              {(Object.keys(DELIVERIES) as Delivery[]).map((d) => (
                <option key={d} value={d}>
                  {DELIVERIES[d].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-neutral-500">
          {delivery === "natural" && "Natural: balanced and conversational."}
          {delivery === "expressive" && "Expressive: more emotion and emphasis; can sound dramatic."}
          {delivery === "steady" && "Steady: even and calm, with less variation."}
        </p>
        {voiceError && <p className="text-xs text-amber-700">{voiceError}</p>}
        <button
          className={btn}
          disabled={busy !== null || !hasScript}
          onClick={() =>
            run("voice", async () => {
              const r = await postJson<{ characters: number; warning: string | null; mock: boolean }>(
                `/api/scans/${scanId}/voice`,
                {
                  ...(voiceId ? { voice_id: voiceId, voice_name: voices.find((v) => v.id === voiceId)?.name } : {}),
                  delivery,
                },
              );
              return r.warning ?? `New take saved and selected (${r.characters} characters${r.mock ? ", mock" : ""}).`;
            })
          }
        >
          {busy === "voice" ? "Generating voice…" : voiceTakes.length > 0 ? "Generate new take" : "Generate voice"}
        </button>
        {!hasScript && <p className="text-sm text-neutral-500">Create the script in the Script tab first.</p>}
      </section>

      {voiceTakes.length > 0 && (
        <section className={card}>
          <h3 className="font-medium">Your voice takes ({voiceTakes.length})</h3>
          <ul className="space-y-3">
            {voiceTakes.map((t) => (
              <li
                key={t.id}
                className={`space-y-2 rounded-lg border p-3 text-sm ${t.selected ? "border-neutral-900 bg-neutral-50" : "bg-white"}`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong>Take {t.number}</strong>
                  <span className="text-neutral-600">
                    {t.voiceName}
                    {t.delivery && t.delivery in DELIVERIES ? ` · ${DELIVERIES[t.delivery as Delivery].label}` : ""}
                  </span>
                  {t.seconds !== null && <span className="text-neutral-500">{Math.round(t.seconds)}s</span>}
                  {t.selected && (
                    <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">In use</span>
                  )}
                  {!t.usable && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Earlier script
                    </span>
                  )}
                  {t.mock && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">Mock</span>}
                </div>
                <audio controls preload="none" src={t.url} className="w-full" />
                <div className="flex flex-wrap items-center gap-2">
                  {!t.selected && (
                    <button
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      disabled={busy !== null || !t.usable}
                      title={t.usable ? undefined : "Made for an earlier script; it doesn't match the current one"}
                      onClick={() =>
                        run(`use-${t.id}`, async () => {
                          await call(`/api/voiceovers/${t.id}/select`, { method: "POST" });
                          return videoUrl
                            ? `Now using Take ${t.number}. The final video was cleared; generate it again to apply this voice.`
                            : `Now using Take ${t.number} for the video.`;
                        })
                      }
                    >
                      Use this one
                    </button>
                  )}
                  <a href={t.downloadUrl} className="rounded-md border px-3 py-1.5 text-sm">
                    Download
                  </a>
                  {!t.selected &&
                    (confirmDelete === t.id ? (
                      <>
                        <button
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`del-${t.id}`, async () => {
                              setConfirmDelete(null);
                              await call(`/api/voiceovers/${t.id}`, { method: "DELETE" });
                              return `Take ${t.number} deleted.`;
                            })
                          }
                        >
                          Delete for good
                        </button>
                        <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded-md border px-3 py-1.5 text-sm text-red-700"
                        disabled={busy !== null}
                        onClick={() => setConfirmDelete(t.id)}
                      >
                        Delete
                      </button>
                    ))}
                  <span className="ml-auto text-xs text-neutral-400" suppressHydrationWarning>
                    {new Date(t.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {audioUrl && (
        <div className="flex justify-end">
          <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => selectTab("animation", true)}>
            Next: Animation →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-animation" aria-labelledby="tab-animation" hidden={tab !== "animation"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Animated clips (Wan 2.5)</h3>
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

      {clips.length > 0 && (
        <div className="flex justify-end">
          <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => selectTab("video", true)}>
            Next: Final Video →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-video" aria-labelledby="tab-video" hidden={tab !== "video"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Final video (1080×1920, 9:16)</h3>
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
              Not happy? Change the script, voice or clips in their tabs and generate again. Source clips are{" "}
              {props.defaultResolution}-quality video scaled up to 1080×1920.
            </p>
          </div>
        )}
      </section>


      {videoUrl && (
        <div className="flex justify-end">
          <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => selectTab("social", true)}>
            Next: Social →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-social" aria-labelledby="tab-social" hidden={tab !== "social"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Social copy: title, description and tags</h3>
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

      <section className={card}>
        <h3 className="font-medium">Connect and post</h3>
        {!social.guarded && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            Set an <code>APP_PASSWORD</code> environment variable first. Connected accounts can post as you, so this app needs a password before it allows connecting.
          </p>
        )}
        {(["tiktok", "instagram"] as const).map((platform) => {
          const label = platform === "tiktok" ? "TikTok" : "Instagram";
          const acct = social.accounts.find((a) => a.platform === platform);
          const connected = Boolean(acct) && !acct?.expired;
          const platformPosts = posts.filter((p) => p.platform === platform);
          const latest = platformPosts[0];
          const hasCopy = copy.some((c) => c.platform === platform);
          const blocked = busy !== null || !videoUrl || !hasCopy;
          return (
            <div key={platform} className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{label}</strong>{" "}
                  <span className="text-neutral-500">
                    {acct ? (acct.expired ? "session expired" : `connected${acct.name ? ` as ${acct.name}` : ""}`) : "not connected"}
                  </span>
                </div>
                {connected ? (
                  <button
                    className="text-xs underline disabled:opacity-40"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`off-${platform}`, async () => {
                        await postJson("/api/social/disconnect", { platform });
                        return `${label} disconnected.`;
                      })
                    }
                  >
                    Disconnect
                  </button>
                ) : (
                  <a
                    className={`rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white ${social.guarded ? "" : "pointer-events-none opacity-40"}`}
                    href={`/api/social/connect?platform=${platform}&scan=${scanId}`}
                    aria-disabled={!social.guarded}
                  >
                    {acct?.expired ? `Reconnect ${label}` : `Connect ${label}`}
                  </a>
                )}
              </div>

              {connected && (
                <div className="space-y-2">
                  {platform === "tiktok" && (
                    <label className="block space-y-1">
                      <span className="text-xs text-neutral-500">Who can see it</span>
                      <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} className="w-full rounded-md border bg-white px-2 py-1.5">
                        <option value="SELF_ONLY">Only me (required until TikTok approves the app)</option>
                        <option value="FOLLOWER_OF_CREATOR">Followers</option>
                        <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                        <option value="PUBLIC_TO_EVERYONE">Everyone</option>
                      </select>
                    </label>
                  )}
                  <button
                    className={btn}
                    disabled={blocked || latest?.status === "processing"}
                    onClick={() =>
                      run(`post-${platform}`, async () => {
                        const again = latest?.status === "published";
                        const r = await call<{ id: string; status: StudioPost["status"] }>(`/api/scans/${scanId}/post`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ platform, privacy, again }),
                        });
                        setPosts((cur) => [{ id: r.id, platform, status: r.status, permalink: null, error: null, privacy: null }, ...cur]);
                        return `Sent to ${label}. It's being processed; this page will update.`;
                      })
                    }
                  >
                    {busy === `post-${platform}` ? "Sending…" : latest?.status === "published" ? `Post to ${label} again` : `Post to ${label}`}
                  </button>
                  {!videoUrl && <p className="text-xs text-neutral-500">Render the final video first.</p>}
                  {videoUrl && !hasCopy && <p className="text-xs text-neutral-500">Generate the social copy first.</p>}
                </div>
              )}

              {latest && (
                <p className={`text-xs ${latest.status === "failed" ? "text-red-700" : latest.status === "published" ? "text-green-700" : "text-neutral-500"}`}>
                  {latest.status === "processing" && `${label} is processing the video…`}
                  {latest.status === "published" && (
                    <>
                      Posted.{" "}
                      {latest.permalink && (
                        <a className="underline" href={latest.permalink} target="_blank" rel="noreferrer">
                          View
                        </a>
                      )}
                      {platform === "tiktok" && " Open TikTok to see it (private posts show on your profile)."}
                    </>
                  )}
                  {latest.status === "failed" && `Failed: ${latest.error ?? "unknown error"}`}
                </p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-neutral-500">
          TikTok keeps posts from unapproved apps private. Instagram needs a Business or Creator account.
        </p>
      </section>
      </div>
    </div>
  );
}
