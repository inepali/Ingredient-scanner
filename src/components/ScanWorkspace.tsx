"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import AppNav from "./AppNav";
import { useRouter } from "next/navigation";
import { DEFAULT_DELIVERY, DELIVERIES, type Delivery } from "@/lib/delivery";
import { withPublicLink } from "@/lib/public-link";
import { REVEAL_CHOICES, type RevealChoice } from "@/lib/reveal";
import { POSITIONS, type CustomLine, type LinePosition } from "@/lib/custom-lines";
import { MAX_UPLOADS, MAX_UPLOAD_BYTES, videoTypeFor } from "@/lib/uploads";
import { CLIP_SECONDS, PRICE_PER_SECOND, estimateCostUsd, type Resolution } from "@/lib/pricing";

export type StudioMedia = {
  id: string;
  kind: "product_image" | "clip";
  url: string;
  source_media_id: string | null;
  is_video: boolean;
  /** A video you uploaded yourself (not an AI-animated photo). */
  uploaded: boolean;
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
  platform: "tiktok" | "instagram" | "youtube";
  title: string;
  description: string;
  hashtags: string[];
};

export type StudioPost = {
  id: string;
  platform: "tiktok" | "instagram" | "youtube";
  status: "processing" | "published" | "failed";
  permalink: string | null;
  error: string | null;
  privacy: string | null;
};

export type StudioSocial = {
  /** APP_PASSWORD is set; connecting and posting are blocked without it. */
  guarded: boolean;
  isPublic: boolean;
  accounts: { platform: "tiktok" | "instagram" | "youtube"; name: string | null; expired: boolean }[];
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
  /** When the score ring and rating badges appear in the video. */
  scoreReveal: RevealChoice;
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

type TabId = "ingredients" | "script" | "voice" | "animation" | "video" | "social" | "public" | "post";

const TABS: { id: TabId; label: string }[] = [
  { id: "ingredients", label: "Ingredients" },
  { id: "script", label: "Script" },
  { id: "voice", label: "Voice" },
  { id: "animation", label: "Animation" },
  { id: "video", label: "Final Video" },
  { id: "social", label: "Social Copy" },
  { id: "public", label: "Public Page" },
  { id: "post", label: "Connect & Post" },
];

const btn =
  "rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const card = "space-y-3 rounded-2xl bg-white p-4";

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

  // Phone: a bottom stepper (Back / step picker / Next) replaces the tab strip.
  const [stepsOpen, setStepsOpen] = useState(false);
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  function selectTab(id: TabId, focus = false) {
    setTab(id);
    setStepsOpen(false);
    if (window.matchMedia("(max-width: 767px)").matches) window.scrollTo({ top: 0 });
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
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index + 1) % TABS.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index - 1 + TABS.length) % TABS.length
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
  // Your own reusable lines for the voiceover (saved in settings, ticked ones go into the next take).
  const [lines, setLines] = useState<CustomLine[]>([]);
  const [newLine, setNewLine] = useState("");
  const [newPos, setNewPos] = useState<LinePosition>("start");
  const [linesError, setLinesError] = useState<string | null>(null);
  const saveLines = (next: CustomLine[]) => {
    setLines(next);
    setLinesError(null);
    postJson<{ lines: CustomLine[] }>("/api/custom-lines", { lines: next }, "PUT").catch((e) =>
      setLinesError(e instanceof Error ? e.message : "Could not save your lines."),
    );
  };
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage?: string; percent?: number } | null>(props.renderProgress);
  const [now, setNow] = useState(() => Date.now());
  const [copyTab, setCopyTab] = useState<StudioCopy["platform"]>("tiktok");
  const [drafts, setDrafts] = useState<Record<string, { title: string; description: string; tags: string }>>({});
  function moveUpload(index: number, delta: number) {
    const ids = uploads.map((u) => u.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void run("reorder", async () => {
      await postJson(`/api/scans/${scanId}/uploads`, { ids }, "PATCH");
    });
  }
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [isPublic, setIsPublic] = useState(social.isPublic);
  const [origin, setOrigin] = useState("");
  const publicUrl = isPublic && origin ? `${origin}/p/${scanId}` : null;
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setIsPublic(social.isPublic), [social.isPublic]);

  /** Sends videos straight to storage (they're too big to pass through the server), then adds them to the scan. */
  async function uploadVideos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotice(null);
    try {
      let added = 0;
      for (const file of Array.from(files)) {
        if (uploads.length + added >= MAX_UPLOADS) throw new Error(`Up to ${MAX_UPLOADS} uploaded videos per scan.`);
        if (!videoTypeFor(file.name, file.type)) throw new Error(`${file.name}: use an MP4, MOV or WebM video.`);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
        setUploadPct(0);
        const slot = await postJson<{ key: string; contentType: string; uploadUrl: string }>(`/api/scans/${scanId}/uploads`, {
          filename: file.name,
          contentType: file.type,
          size: file.size,
        });
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", slot.uploadUrl);
          xhr.setRequestHeader("Content-Type", slot.contentType);
          xhr.upload.onprogress = (e) => e.lengthComputable && setUploadPct(Math.round((e.loaded / e.total) * 100));
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
          xhr.onerror = () =>
            reject(new Error("The upload was blocked. Your video storage needs a CORS rule that allows PUT from this site (see the README)."));
          xhr.send(file);
        });
        await postJson(`/api/scans/${scanId}/uploads`, { key: slot.key }, "PUT");
        added++;
      }
      setNotice(`Added ${added} video${added === 1 ? "" : "s"}. They'll be used in the final video.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadPct(null);
    }
  }

  const [privacy, setPrivacy] = useState("SELF_ONLY");
  const [coverSeconds, setCoverSeconds] = useState("1");
  const [ytPrivacy, setYtPrivacy] = useState("private");
  const [copied, setCopied] = useState<string | null>(null);
  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 2000);
    });
  }
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

  const [reveal, setReveal] = useState<RevealChoice>(props.scoreReveal);
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

  useEffect(() => {
    call<{ lines: CustomLine[] }>("/api/custom-lines")
      .then((r) => setLines(r.lines))
      .catch(() => {});
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
  const uploads = clips.filter((c) => c.uploaded);
  const animated = clips.filter((c) => !c.uploaded);
  const clipBySource = new Map(clips.map((c) => [c.source_media_id, c]));
  const pendingSources = new Set(pendingJobs.map((j) => j.media_id));
  const unanimated = photos.filter((p) => !clipBySource.has(p.id) && !pendingSources.has(p.id));
  const slots = Math.max(0, maxClips - animated.length - pendingJobs.length);
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
    public: isPublic ? "done" : null,
    post: posts.some((p) => p.status === "processing") ? "busy" : posts.some((p) => p.status === "published") ? "done" : null,
  };

  return (
    <div className="space-y-6">
      {mock && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Mock mode is on: voice is silent and clips reuse your photos. Nothing paid is called.
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      <nav aria-label="Scan steps" className="md:sticky md:top-6 md:w-52 md:shrink-0">
        <div className="hidden md:block">
          <AppNav scanId={scanId} />
        </div>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Scan steps"
          className="-mx-1 hidden gap-1 overflow-x-auto border-b px-1 md:mx-0 md:flex md:flex-col md:gap-0.5 md:overflow-visible md:border-b-0 md:px-0"
        >
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
                className={`-mb-px flex shrink-0 items-center gap-2.5 whitespace-nowrap border-b-2 px-3 py-2 text-left text-sm md:mb-0 md:w-full md:rounded-lg md:border-b-0 md:py-2.5 ${
                  active
                    ? "border-accent font-medium text-accent md:bg-accent md:text-white"
                    : "border-transparent text-neutral-500 hover:text-neutral-800 md:hover:bg-neutral-100"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs md:flex ${
                    st === "done" ? "bg-green-600 text-white" : active ? "bg-white/20 text-white" : "bg-neutral-200 text-neutral-600"
                  }`}
                >
                  {st === "done" ? "✓" : i + 1}
                </span>
                <span className="flex-1">{t.label}</span>
                {st === "done" && (
                  <span className="text-green-600 md:hidden" aria-label="done">
                    ✓
                  </span>
                )}
                {st === "busy" && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-label="in progress" />}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 flex-1">
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
                className="w-full rounded-xl bg-neutral-100 px-2 py-2"
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
                className="w-full rounded-xl bg-neutral-100 px-2 py-2"
              />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-500">Delivery</span>
            <select
              value={delivery}
              onChange={(e) => setDelivery(e.target.value as Delivery)}
              disabled={busy !== null}
              className="w-full rounded-xl bg-neutral-100 px-2 py-2"
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

        <div className="space-y-2 rounded-2xl bg-neutral-50 p-3">
          <h4 className="text-sm font-medium">Your own lines</h4>
          <p className="text-xs text-neutral-500">
            Add a hook, something you did, or a catchphrase. Ticked lines are spoken in the next take at the spot you choose, with captions
            to match. Your list is saved for every scan. Keep each to one or two sentences.
          </p>
          {lines.length > 0 && (
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={l.enabled}
                    aria-label="Use this line in the next take"
                    onChange={(e) => saveLines(lines.map((x) => (x.id === l.id ? { ...x, enabled: e.target.checked } : x)))}
                  />
                  <input
                    defaultValue={l.text}
                    maxLength={220}
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      if (text === l.text) return;
                      saveLines(text ? lines.map((x) => (x.id === l.id ? { ...x, text } : x)) : lines.filter((x) => x.id !== l.id));
                    }}
                    className="min-w-[12rem] flex-1 rounded-xl bg-neutral-100 px-2 py-1 text-sm"
                  />
                  <select
                    value={l.position}
                    aria-label="Where to say it"
                    onChange={(e) => saveLines(lines.map((x) => (x.id === l.id ? { ...x, position: e.target.value as LinePosition } : x)))}
                    className="rounded-xl bg-neutral-100 px-2 py-1 text-xs"
                  >
                    {POSITIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="text-xs text-red-600 underline" onClick={() => saveLines(lines.filter((x) => x.id !== l.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
              maxLength={220}
              placeholder="e.g. I checked 20 snack bars so you don't have to."
              className="min-w-[12rem] flex-1 rounded-xl bg-neutral-100 px-2 py-1 text-sm"
            />
            <select value={newPos} onChange={(e) => setNewPos(e.target.value as LinePosition)} className="rounded-xl bg-neutral-100 px-2 py-1 text-xs">
              {POSITIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-xl bg-neutral-100 px-3 py-1 text-sm"
              disabled={!newLine.trim()}
              onClick={() => {
                saveLines([...lines, { id: `l-${Date.now().toString(36)}`, text: newLine.trim(), position: newPos, enabled: true }]);
                setNewLine("");
              }}
            >
              Add line
            </button>
          </div>
          {linesError && <p className="text-xs text-amber-700">{linesError}</p>}
        </div>

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
                  custom_lines: lines.filter((l) => l.enabled),
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
                className={`space-y-2 rounded-2xl border p-3 text-sm ${t.selected ? "border-accent bg-accent-soft" : "bg-white"}`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong>Take {t.number}</strong>
                  <span className="text-neutral-600">
                    {t.voiceName}
                    {t.delivery && t.delivery in DELIVERIES ? ` · ${DELIVERIES[t.delivery as Delivery].label}` : ""}
                  </span>
                  {t.seconds !== null && <span className="text-neutral-500">{Math.round(t.seconds)}s</span>}
                  {t.selected && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">In use</span>
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
                      className="rounded-xl bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
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
                  <a href={t.downloadUrl} className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm">
                    Download
                  </a>
                  {!t.selected &&
                    (confirmDelete === t.id ? (
                      <>
                        <button
                          className="rounded-xl bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
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
                        <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm text-red-700"
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
          <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => selectTab("animation", true)}>
            Next: Animation →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-animation" aria-labelledby="tab-animation" hidden={tab !== "animation"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Animate your photos (Wan 2.5)</h3>
        {photos.length === 0 ? (
          <p className="text-sm text-neutral-500">No product photos on this scan. Upload your own product video below instead.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
              {photos.map((p) => {
                const clip = clipBySource.get(p.id);
                const pending = pendingSources.has(p.id);
                const label = clip ? (clip.is_video ? "Animated" : "Mock clip") : pending ? "Animating…" : "Photo (slow zoom)";
                return (
                  <figure key={p.id} className="space-y-1">
                    <div className="aspect-[9/16] overflow-hidden rounded-xl bg-neutral-100">
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
                className="rounded-xl bg-neutral-100 px-2 py-2 text-sm"
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
              {CLIP_SECONDS}-second clips, up to {maxClips} per scan. Photos you don&apos;t animate get a slow zoom, unless you upload your own video, which replaces them.
              {pendingJobs.length > 0 && ` ${pendingJobs.length} rendering now; this page updates itself.`}
            </p>
          </>
        )}
      </section>

      <section className={card}>
        <h3 className="font-medium">Or upload your own product video</h3>
        <p className="text-sm text-neutral-500">
          Real footage of the product (MP4, MOV or WebM, up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB each). Your videos are joined whole, in the
          order shown (use the arrows to change it), under the voiceover. Nothing is trimmed, and photos and AI clips aren&apos;t used. If your
          footage is shorter than the voiceover it&apos;s slowed down (down to half speed), then repeated if needed. If it&apos;s longer, the video simply runs past the
          voice. The videos&apos; own sound is replaced by the voiceover. No AI credits are used.
        </p>
        <label className={`inline-block cursor-pointer rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium ${uploadPct !== null || uploads.length >= MAX_UPLOADS ? "pointer-events-none opacity-40" : ""}`}>
          {uploadPct !== null ? `Uploading… ${uploadPct}%` : "Choose video"}
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
            multiple
            className="sr-only"
            disabled={uploadPct !== null || uploads.length >= MAX_UPLOADS}
            onChange={(e) => {
              void uploadVideos(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {uploadPct !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}
        {uploads.length > 0 && (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
            {uploads.map((u, idx) => (
              <figure key={u.id} className="space-y-1">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-neutral-100">
                  <video src={u.url} controls muted loop playsInline preload="metadata" className="h-full w-full object-contain" />
                  <span className="absolute left-1 top-1 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">{idx + 1}</span>
                </div>
                <figcaption className="flex items-center justify-center gap-2">
                  <button
                    className="rounded border px-2 text-sm disabled:opacity-30"
                    aria-label={`Move video ${idx + 1} earlier`}
                    disabled={busy !== null || idx === 0}
                    onClick={() => moveUpload(idx, -1)}
                  >
                    ←
                  </button>
                  <button
                    className="rounded border px-2 text-sm disabled:opacity-30"
                    aria-label={`Move video ${idx + 1} later`}
                    disabled={busy !== null || idx === uploads.length - 1}
                    onClick={() => moveUpload(idx, 1)}
                  >
                    →
                  </button>
                </figcaption>
                <figcaption className="text-center">
                  <button
                    className="text-xs text-neutral-500 underline disabled:opacity-40"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`rm-${u.id}`, async () => {
                        await call(`/api/clips/${u.id}`, { method: "DELETE" });
                        return "Video removed.";
                      })
                    }
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {clips.length > 0 && (
        <div className="flex justify-end">
          <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => selectTab("video", true)}>
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
          {clips.length === 0 && !renderJobId && " No clips or videos yet, so your photos will be used."}
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
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.max(percent, 2)}%` }} />
            </div>
            <p className="text-xs text-neutral-500">
              A 60-second video usually takes under a minute. You can leave this page; it will be here when you
              come back.
            </p>
            <button
              className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm"
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
          <>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-neutral-500">Show the score and rating badges</span>
            <select value={reveal} onChange={(e) => setReveal(e.target.value as RevealChoice)} className="w-full rounded-xl bg-neutral-100 px-2 py-2 text-sm">
              {REVEAL_CHOICES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="block text-xs text-neutral-500">Holding the score back gives people a reason to keep watching.</span>
          </label>
          <button
            className={btn}
            disabled={busy !== null || !audioUrl}
            onClick={() =>
              run("render", async () => {
                setProgress(null);
                await postJson(`/api/scans/${scanId}/render`, { reveal });
              })
            }
          >
            {busy === "render" ? "Starting…" : videoUrl ? "Generate again" : "Generate video"}
          </button>
          </>
        )}
        {!audioUrl && <p className="text-sm text-neutral-500">Generate the voice first.</p>}
        {renderError && renderJobId === null && <p className="text-sm text-red-600">{renderError}</p>}

        {videoUrl && renderJobId === null && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Review your video</p>
            <video src={videoUrl} controls playsInline className="aspect-[9/16] w-full max-w-xs rounded-lg bg-black" />
            {downloadUrl && (
              <a href={downloadUrl} className="inline-block rounded-xl bg-neutral-100 px-3 py-1.5 text-sm underline">
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
          <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => selectTab("social", true)}>
            Next: Social Copy →
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
              Happy with the video? Write the post text for TikTok, Instagram and YouTube, then edit each one in its tab.
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

        {copy.length > 0 && (
          <div role="tablist" aria-label="Platform" className="flex gap-1 rounded-lg bg-neutral-100 p-1">
            {(["tiktok", "instagram", "youtube"] as const).map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={copyTab === p}
                onClick={() => setCopyTab(p)}
                className={`min-h-10 flex-1 rounded-xl px-2 text-sm ${copyTab === p ? "bg-white font-medium shadow-sm" : "text-neutral-600"}`}
              >
                {p === "tiktok" ? "TikTok" : p === "instagram" ? "Instagram" : "YouTube"}
              </button>
            ))}
          </div>
        )}

        {copy.filter((c) => c.platform === copyTab).map((c) => {
          const d = drafts[c.platform];
          if (!d) return null;
          const saved = d.title === c.title && d.description === c.description && d.tags === c.hashtags.map((h) => `#${h}`).join(" ");
          const tagCount = d.tags.split(/\s+/).filter(Boolean).length;
          const set = (patch: Partial<typeof d>) => setDrafts({ ...drafts, [c.platform]: { ...d, ...patch } });
          return (
            <div key={c.platform} className="space-y-2 rounded-xl bg-neutral-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{c.platform === "tiktok" ? "TikTok" : c.platform === "instagram" ? "Instagram" : "YouTube"}</strong>
                <button
                  className="rounded-xl bg-neutral-100 px-3 py-1 text-xs font-medium"
                  onClick={() =>
                    copyText(
                      c.platform,
                      // YouTube ignores every hashtag when a description has more than 15, so only the first few go in the text.
                      `${d.title}\n\n${withPublicLink(d.description, publicUrl)}\n\n${c.platform === "youtube" ? d.tags.split(/\s+/).filter(Boolean).slice(0, 4).join(" ") : d.tags}`,
                    )
                  }
                  aria-live="polite"
                >
                  {copied === c.platform ? "Copied ✓" : "Copy all"}
                </button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Title ({d.title.length}/100)</span>
                <input
                  value={d.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className="w-full rounded-xl bg-neutral-100 px-2 py-1.5"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Description ({d.description.length}/2200)</span>
                <textarea
                  value={d.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={5}
                  className="w-full rounded-xl bg-neutral-100 px-2 py-1.5"
                />
              </label>
              {publicUrl && (
                <p className="text-xs text-neutral-500">
                  Link added after the &quot;not medical advice&quot; line when you post or copy: <span className="break-all">{publicUrl}</span>
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-neutral-500">Hashtags ({tagCount})</span>
                <textarea
                  value={d.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  rows={2}
                  className="w-full rounded-xl bg-neutral-100 px-2 py-1.5"
                />
              </label>
              {c.platform === "youtube" && (
                <div className="space-y-1 text-xs text-neutral-500">
                  <p>
                    {tagCount} tags. When you post from here, all of them are sent as hidden YouTube tags and only the first 4 (plus #Shorts) appear in the description, because YouTube ignores
                    hashtags if a description has more than 15.
                  </p>
                  <button
                    type="button"
                    className="rounded-xl bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-900"
                    onClick={() => copyText("yt-tags", d.tags.split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, "")).join(", "))}
                    aria-live="polite"
                  >
                    {copied === "yt-tags" ? "Copied ✓" : "Copy tags for YouTube Studio"}
                  </button>
                </div>
              )}
              <button
                className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm disabled:opacity-40"
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

      {copy.length > 0 && (
        <div className="flex justify-end">
          <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => selectTab("public", true)}>
            Next: Public Page →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-public" aria-labelledby="tab-public" hidden={tab !== "public"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Public page</h3>
        <p className="text-sm text-neutral-500">
          A shareable page with the score and the full ingredient breakdown. Add the link to your video description. It&apos;s private until you turn it on.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={busy !== null}
            onClick={() =>
              run("public", async () => {
                const r = await postJson<{ is_public: boolean }>(`/api/scans/${scanId}`, { is_public: !isPublic }, "PATCH");
                setIsPublic(r.is_public);
                return r.is_public ? "Public page is on." : "Public page is off.";
              })
            }
          >
            {isPublic ? "Turn off" : "Make public"}
          </button>
          {isPublic && (
            <>
              <a className="text-sm underline" href={`/p/${scanId}`} target="_blank" rel="noreferrer">
                Open page
              </a>
              <button className="rounded-xl bg-neutral-100 px-3 py-1 text-sm font-medium" onClick={() => copyText("link", `${origin}/p/${scanId}`)} aria-live="polite">
                {copied === "link" ? "Copied ✓" : "Copy link"}
              </button>
            </>
          )}
        </div>
        {isPublic && <p className="break-all text-xs text-neutral-400">{origin}/p/{scanId}</p>}
        {isPublic && <p className="text-xs text-neutral-500">When you post from here, the link is added to the caption automatically.</p>}
      </section>

      {(
        <div className="flex justify-end">
          <button className="rounded-xl bg-neutral-100 px-3 py-1.5 text-sm" onClick={() => selectTab("post", true)}>
            Next: Connect &amp; Post →
          </button>
        </div>
      )}
      </div>
      <div role="tabpanel" id="panel-post" aria-labelledby="tab-post" hidden={tab !== "post"} className="space-y-4 pt-4">
      <section className={card}>
        <h3 className="font-medium">Connect and post</h3>
        {!social.guarded && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            Set an <code>APP_PASSWORD</code> environment variable first. Connected accounts can post as you, so this app needs a password before it allows connecting.
          </p>
        )}
        {(["instagram", "tiktok", "youtube"] as const).map((platform) => {
          const label = platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "YouTube";
          const acct = social.accounts.find((a) => a.platform === platform);
          const connected = Boolean(acct) && !acct?.expired;
          const platformPosts = posts.filter((p) => p.platform === platform);
          const latest = platformPosts[0];
          const hasCopy = platform === "youtube" ? copy.length > 0 : copy.some((c) => c.platform === platform);
          const blocked = busy !== null || !videoUrl || !hasCopy;
          return (
            <div key={platform} className="space-y-2 rounded-xl bg-neutral-50 p-3 text-sm">
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
                    className={`rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white ${social.guarded ? "" : "pointer-events-none opacity-40"}`}
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
                      <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} className="w-full rounded-xl bg-neutral-100 px-2 py-1.5">
                        <option value="SELF_ONLY">Only me (required until TikTok approves the app)</option>
                        <option value="FOLLOWER_OF_CREATOR">Followers</option>
                        <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                        <option value="PUBLIC_TO_EVERYONE">Everyone</option>
                      </select>
                    </label>
                  )}
                  {platform === "tiktok" && (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 text-xs text-neutral-500">
                        Cover picture at
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={0.5}
                          value={coverSeconds}
                          onChange={(e) => setCoverSeconds(e.target.value)}
                          className="w-20 rounded-xl bg-neutral-100 px-2 py-1 text-sm text-neutral-900"
                        />
                        seconds into the video
                      </label>
                      <p className="text-xs text-neutral-500">Marked as AI-generated (TikTok requires this for AI voice and clips). Comments, duets and stitches stay on.</p>
                    </div>
                  )}
                  <button
                    className={btn}
                    disabled={blocked || latest?.status === "processing"}
                    onClick={() =>
                      run(`post-${platform}`, async () => {
                        const again = latest?.status === "published";
                        const r = await call<{ id: string; status: StudioPost["status"]; permalink?: string | null }>(`/api/scans/${scanId}/post`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ platform, privacy: platform === "youtube" ? ytPrivacy : privacy, again, cover_seconds: Number(coverSeconds) || 1 }),
                        });
                        setPosts((cur) => [{ id: r.id, platform, status: r.status, permalink: r.permalink ?? null, error: null, privacy: null }, ...cur]);
                        return r.status === "published" ? `Posted to ${label}.` : `Sent to ${label}. It's being processed; this page will update.`;
                      })
                    }
                  >
                    {busy === `post-${platform}` ? "Sending…" : latest?.status === "published" ? `Post to ${label} again` : `Post to ${label}`}
                  </button>
                  {platform === "youtube" && (
                    <label className="block space-y-1">
                      <span className="text-xs text-neutral-500">Who can see it</span>
                      <select value={ytPrivacy} onChange={(e) => setYtPrivacy(e.target.value)} className="w-full rounded-xl bg-neutral-100 px-2 py-1.5">
                        <option value="private">Private (YouTube keeps new apps private until Google approves them)</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                  )}
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
                      {platform === "youtube" && " YouTube may take a few minutes to finish processing."}
                    </>
                  )}
                  {latest.status === "failed" && `Failed: ${latest.error ?? "unknown error"}`}
                </p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-neutral-500">
          TikTok and YouTube keep posts from unapproved apps private. Instagram needs a Business or Creator account. YouTube uses its own title, description and hashtags from the Social Copy tab.
        </p>
      </section>
      </div>
      </div>

      {/* Phone only: pick a step from a sheet, or step Back / Next with big thumb-sized buttons. */}
      {stepsOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setStepsOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <ul
            role="menu"
            aria-label="Steps"
            className="absolute inset-x-0 bottom-0 max-h-[80vh] space-y-1 overflow-y-auto rounded-t-3xl bg-[#f2f2f7] p-3 pb-28 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <li aria-hidden className="pb-2 pt-1">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-neutral-300" />
            </li>
            {TABS.map((t, i) => {
              const st = tabStatus[t.id];
              return (
                <li key={t.id}>
                  <button
                    role="menuitem"
                    onClick={() => selectTab(t.id)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base ${t.id === tab ? "bg-accent font-semibold text-white" : "bg-white"}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${st === "done" ? "bg-green-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
                      {st === "done" ? "✓" : i + 1}
                    </span>
                    <span className="flex-1">{t.label}</span>
                    {st === "busy" && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-label="in progress" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 border-t bg-white/80 px-3 pt-2 pb-safe backdrop-blur-xl md:hidden">
        <button
          className="min-h-11 min-w-11 rounded-full bg-neutral-100 text-lg text-accent disabled:opacity-30"
          disabled={tabIndex <= 0}
          onClick={() => selectTab(TABS[tabIndex - 1].id)}
          aria-label="Previous step"
        >
          ←
        </button>
        <button
          className="min-h-11 flex-1 rounded-full bg-neutral-100 px-3 text-[15px] font-semibold"
          aria-expanded={stepsOpen}
          onClick={() => setStepsOpen((o) => !o)}
        >
          {TABS[tabIndex]?.label} <span className="font-normal text-neutral-500">· {tabIndex + 1}/{TABS.length} ▴</span>
        </button>
        <button
          className="min-h-11 min-w-11 rounded-full bg-accent text-lg text-white disabled:opacity-30"
          disabled={tabIndex >= TABS.length - 1}
          onClick={() => selectTab(TABS[tabIndex + 1].id)}
          aria-label="Next step"
        >
          →
        </button>
      </div>
      </div>
    </div>
  );
}
