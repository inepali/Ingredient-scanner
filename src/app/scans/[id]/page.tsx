import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { bandFor, type Band } from "@/lib/scoring";
import { parseScript, type VideoScript } from "@/lib/script";
import ScriptSection from "@/components/ScriptSection";
import { isMock } from "@/lib/mock";
import { mediaUrls, type MediaBucket } from "@/lib/storage";
import type { CopyRow, JobRow, MediaRow } from "@/lib/db-types";
import VideoStudio, { type StudioCopy, type StudioMedia } from "@/components/VideoStudio";

export const dynamic = "force-dynamic";

// Full class names so Tailwind can see them.
const BAND_BAR: Record<Band, string> = {
  great: "bg-green-600",
  good: "bg-lime-500",
  fair: "bg-yellow-400",
  poor: "bg-orange-500",
  avoid: "bg-red-600",
};
const BAND_STROKE: Record<Band, string> = {
  great: "stroke-green-600",
  good: "stroke-lime-500",
  fair: "stroke-yellow-400",
  poor: "stroke-orange-500",
  avoid: "stroke-red-600",
};
const BAND_LABEL: Record<Band, string> = {
  great: "Great",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  avoid: "Avoid",
};

type Ingredient = {
  id: string;
  position: number;
  raw_name: string;
  score: number;
  band: Band;
  reason: string | null;
  provisional: boolean;
};

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();

  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, status, overall_score, allergens")
    .eq("id", id)
    .maybeSingle();
  if (!scan) notFound();
  if (scan.status === "created") redirect(`/new/${id}`);

  if (scan.status !== "analyzed" || scan.overall_score === null) {
    return (
      <div className="space-y-4">
        <p>This scan {scan.status === "failed" ? "failed" : "is still being analyzed"}.</p>
        <Link href={`/new/${id}`} className="underline">
          {scan.status === "failed" ? "Retake the label photo and retry" : "Back to this scan's photos"}
        </Link>
      </div>
    );
  }

  const { data } = await db
    .from("scan_ingredients")
    .select("id, position, raw_name, score, band, reason, provisional")
    .eq("scan_id", id)
    .order("position");
  const ingredients = (data ?? []) as Ingredient[];

  const { data: video } = await db
    .from("videos")
    .select("script, audio_path, duration_s")
    .eq("scan_id", id)
    .not("script", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let latestScript: VideoScript | null = null;
  if (video?.script) {
    try {
      latestScript = parseScript(video.script);
    } catch {
      // unreadable stored script; show the button instead
    }
  }

  // Data for the voice / clips / post copy studio below the script.
  const { data: mediaData } = await db
    .from("scan_media")
    .select("id, kind, storage_path, sort_order, source_media_id")
    .eq("scan_id", id)
    .in("kind", ["product_image", "clip"])
    .order("sort_order");
  const mediaRows = (mediaData ?? []) as Pick<
    MediaRow,
    "id" | "kind" | "storage_path" | "sort_order" | "source_media_id"
  >[];
  const { data: copyData } = await db
    .from("social_copy")
    .select("platform, title, description, hashtags")
    .eq("scan_id", id);
  const { data: jobData } = await db
    .from("jobs")
    .select("id, input")
    .eq("scan_id", id)
    .eq("step", "i2v")
    .eq("status", "running");

  // Photos live in the images bucket; clips and the voiceover in the videos bucket.
  const bucketFor = (kind: string): MediaBucket => (kind === "clip" ? "videos" : "images");
  const urls = await mediaUrls([
    ...mediaRows.map((m) => ({ bucket: bucketFor(m.kind), key: m.storage_path })),
    ...(video?.audio_path ? [{ bucket: "videos" as const, key: video.audio_path as string }] : []),
  ]);
  const studioMedia: StudioMedia[] = mediaRows.map((m) => ({
    id: m.id,
    kind: m.kind as "product_image" | "clip",
    url: urls.get(m.storage_path) ?? "",
    source_media_id: m.source_media_id,
    is_video: m.storage_path.endsWith(".mp4"),
  }));
  const studioCopy: StudioCopy[] = ((copyData ?? []) as CopyRow[]).map((c) => ({
    platform: c.platform,
    title: c.title ?? "",
    description: c.description ?? "",
    hashtags: c.hashtags ?? [],
  }));
  const pendingJobs = ((jobData ?? []) as Pick<JobRow, "id" | "input">[]).map((j) => ({
    id: j.id,
    media_id: j.input?.media_id ?? null,
  }));
  const defaultResolution = process.env.WAN_RESOLUTION === "720p" ? "720p" : "480p";

  const overall: number = scan.overall_score;
  const overallBand = bandFor(overall);
  const R = 54;
  const C = 2 * Math.PI * R;
  const allergens: string[] = scan.allergens ?? [];

  return (
    <div className="space-y-8">
      <div className="flex gap-4 text-sm text-neutral-500">
        <Link href="/" className="underline">
          ← New scan
        </Link>
        <Link href="/history" className="underline">
          History
        </Link>
      </div>

      <header className="flex items-center gap-6">
        <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={`Overall score ${overall} out of 100`}>
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-neutral-200" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - overall / 100)}
            className={BAND_STROKE[overallBand]}
          />
          <text
            x="60"
            y="60"
            textAnchor="middle"
            dominantBaseline="central"
            className="rotate-90 fill-neutral-900 text-3xl font-semibold"
            style={{ transformOrigin: "60px 60px" }}
          >
            {overall}
          </text>
        </svg>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{scan.product_name ?? "Scanned product"}</h1>
          <p className="text-neutral-600">
            Overall: <strong>{BAND_LABEL[overallBand]}</strong> ({overall}/100)
          </p>
          {allergens.length > 0 && (
            <p className="text-sm text-neutral-500">Contains: {allergens.join(", ")}</p>
          )}
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-medium">Ingredients ({ingredients.length})</h2>
        <ol className="space-y-3">
          {ingredients.map((ing) => (
            <li key={ing.id} className="rounded-lg border bg-white p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {ing.position}. {ing.raw_name}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-neutral-600">
                  {ing.score} · {BAND_LABEL[ing.band]}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className={`h-full ${BAND_BAR[ing.band]}`} style={{ width: `${ing.score}%` }} />
              </div>
              {ing.reason && <p className="mt-2 text-sm text-neutral-600">{ing.reason}</p>}
              {ing.provisional && (
                <p className="mt-1 text-xs text-neutral-400">Estimated by AI (not in the reference table yet)</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <ScriptSection scanId={id} initial={latestScript} />

      {latestScript && (
        <VideoStudio
          scanId={id}
          media={studioMedia}
          hasScript
          audioUrl={video?.audio_path ? (urls.get(video.audio_path as string) ?? null) : null}
          audioSeconds={video?.duration_s ?? null}
          copy={studioCopy}
          pendingJobs={pendingJobs}
          maxClips={Number(process.env.MAX_CLIPS ?? 4)}
          defaultResolution={defaultResolution}
          mock={isMock()}
        />
      )}

      <p className="text-xs text-neutral-400">
        Scores are a general nutrition rubric, not medical advice.
      </p>
    </div>
  );
}
