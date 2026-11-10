import Link from "next/link";
import LargeTitle from "@/components/LargeTitle";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import DeleteScanButton from "@/components/DeleteScanButton";
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
    <AppShell>
    <div className="space-y-6">
      <LargeTitle
        title="History"
        subtitle={
          average !== null ? (
            <>
              {scans.length} {scans.length === 1 ? "scan" : "scans"} · average score <strong className="text-neutral-700">{average}</strong>/100
            </>
          ) : undefined
        }
      />

      {scans.length === 0 ? (
        <p className="text-neutral-600">No scans yet. Scan a label to see it here.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl bg-white">
          {scans.map((s) => {
            const band = bandFor(s.overall_score);
            return (
              <li key={s.id} className="flex items-center gap-1 pr-2">
                <Link href={`/scans/${s.id}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 active:bg-neutral-100">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums text-white ${BAND_BADGE[band]}`}>
                    {s.overall_score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-medium">{s.product_name ?? "Scanned product"}</span>
                    <span className="block text-[13px] text-neutral-500">
                      {BAND_LABEL[band]} · {new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </span>
                  <svg viewBox="0 0 8 14" className="h-3.5 w-2 shrink-0 text-neutral-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m1 1 6 6-6 6" />
                  </svg>
                </Link>
                <DeleteScanButton scanId={s.id} name={s.product_name} after="refresh" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </AppShell>
  );
}
