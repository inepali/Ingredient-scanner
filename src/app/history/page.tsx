import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { bandFor, type Band } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const BAND_BADGE: Record<Band, string> = {
  great: "bg-green-600",
  good: "bg-lime-500",
  fair: "bg-yellow-400",
  poor: "bg-orange-500",
  avoid: "bg-red-600",
};
const BAND_LABEL: Record<Band, string> = {
  great: "Great",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  avoid: "Avoid",
};

type ScanRow = {
  id: string;
  product_name: string | null;
  overall_score: number;
  created_at: string;
};

export default async function HistoryPage() {
  const { data, error } = await supabase()
    .from("scans")
    .select("id, product_name, overall_score, created_at")
    .eq("status", "analyzed")
    .not("overall_score", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load history: ${error.message}`);

  const scans = (data ?? []) as ScanRow[];
  const average = scans.length
    ? Math.round(scans.reduce((sum, s) => sum + s.overall_score, 0) / scans.length)
    : null;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-neutral-500 underline">
        ← New scan
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Scan history</h1>
        {average !== null && (
          <p className="text-neutral-600">
            {scans.length} {scans.length === 1 ? "scan" : "scans"} · average score{" "}
            <strong>{average}</strong>/100
          </p>
        )}
      </header>

      {scans.length === 0 ? (
        <p className="text-neutral-600">No scans yet. Scan a label to see it here.</p>
      ) : (
        <ul className="space-y-2">
          {scans.map((s) => {
            const band = bandFor(s.overall_score);
            return (
              <li key={s.id}>
                <Link
                  href={`/scans/${s.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border bg-white p-3 hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.product_name ?? "Scanned product"}</span>
                    <span className="block text-xs text-neutral-500">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
                    <span className={`h-2.5 w-2.5 rounded-full ${BAND_BADGE[band]}`} />
                    {s.overall_score} · {BAND_LABEL[band]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
