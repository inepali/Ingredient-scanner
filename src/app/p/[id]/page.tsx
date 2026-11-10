import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { bandFor, type Band } from "@/lib/scoring";
import type { OffSummary } from "@/lib/openfoodfacts";
import ScoreRing from "@/components/ScoreRing";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BAR: Record<Band, string> = {
  great: "bg-green-600",
  good: "bg-lime-500",
  fair: "bg-yellow-400",
  poor: "bg-orange-500",
  avoid: "bg-red-600",
};
const LABEL: Record<Band, string> = { great: "Great", good: "Good", fair: "Fair", poor: "Poor", avoid: "Avoid" };

type Ing = { position: number; raw_name: string; score: number; reason: string | null };

async function load(id: string) {
  if (!UUID.test(id)) return null;
  const db = supabase();
  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, overall_score, allergens, off_data, is_public, status")
    .eq("id", id)
    .maybeSingle();
  if (!scan || !scan.is_public || scan.status !== "analyzed" || scan.overall_score == null) return null;
  const { data: ings } = await db
    .from("scan_ingredients")
    .select("position, raw_name, score, reason")
    .eq("scan_id", id)
    .order("position");
  return { scan, ingredients: (ings ?? []) as Ing[] };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: "Not found", robots: { index: false } };
  const name = data.scan.product_name ?? "Scanned product";
  return {
    title: `${name}: ${data.scan.overall_score}/100 ingredient score`,
    description: `Ingredient-by-ingredient health breakdown for ${name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicScanPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { scan, ingredients } = data;
  const score = scan.overall_score as number;
  const band = bandFor(score);
  const allergens: string[] = scan.allergens ?? [];
  const off = (scan.off_data ?? null) as OffSummary | null;

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-6">
        <ScoreRing score={score} />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{scan.product_name ?? "Scanned product"}</h1>
          <p className="text-neutral-600">
            Overall: <strong>{LABEL[band]}</strong> ({score}/100)
          </p>
          {allergens.length > 0 && <p className="text-sm text-neutral-500">Contains: {allergens.join(", ")}</p>}
        </div>
      </header>

      {off && (off.nutriscore || off.nova || off.green) && (
        <section className="space-y-1 rounded-2xl bg-white p-4 text-sm">
          <p className="font-medium">Also checked against Open Food Facts</p>
          <p className="text-neutral-600">
            {[
              off.nutriscore ? `Nutri-Score ${off.nutriscore.toUpperCase()}` : null,
              off.nova ? `NOVA ${off.nova}` : null,
              off.green ? `Green-Score ${off.green.replace("-plus", "+").toUpperCase()}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Ingredients, in label order</h2>
        <ol className="space-y-2">
          {ingredients.map((ing) => {
            const b = bandFor(ing.score);
            return (
              <li key={ing.position} className="rounded-2xl bg-white p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium capitalize">{ing.raw_name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-neutral-600">
                    {ing.score} · {LABEL[b]}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className={`h-full ${BAR[b]}`} style={{ width: `${ing.score}%` }} />
                </div>
                {ing.reason && <p className="mt-2 text-sm text-neutral-600">{ing.reason}</p>}
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="space-y-1 text-xs text-neutral-400">
        <p>AI-assisted analysis using a general nutrition rubric. Not medical advice.</p>
        {off && (
          <p>
            Product data from{" "}
            <a className="underline" href={off.url} target="_blank" rel="noreferrer">
              Open Food Facts
            </a>{" "}
            (ODbL).
          </p>
        )}
      </footer>
    </div>
  );
}
