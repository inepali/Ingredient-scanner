import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeLabel } from "@/lib/analyze";
import { getMedia } from "@/lib/storage";
import { bandFor, normalizeName, overallScore } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 60;

type RefRow = { id: string; canonical_name: string; aliases: string[] | null; score: number };

async function handle(id: string) {
  const db = supabase();

  const { data: scan } = await db.from("scans").select("id, status").eq("id", id).maybeSingle();
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (scan.status === "analyzed") return NextResponse.json({ id });

  const { data: label } = await db
    .from("scan_media")
    .select("storage_path")
    .eq("scan_id", id)
    .eq("kind", "label")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!label) {
    return NextResponse.json({ error: "Upload the ingredient label photo first." }, { status: 400 });
  }

  await db.from("scans").update({ status: "analyzing" }).eq("id", id);
  const { data: job } = await db
    .from("jobs")
    .insert({ scan_id: id, step: "analyze", status: "running" })
    .select("id")
    .single();

  const fail = async (message: string, status: number) => {
    await db.from("scans").update({ status: "failed" }).eq("id", id);
    if (job) await db.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
    return NextResponse.json({ error: message }, { status });
  };

  try {
    const bytes = await getMedia("images", label.storage_path);
    const mediaType = label.storage_path.endsWith(".png")
      ? "image/png"
      : label.storage_path.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    const analysis = await analyzeLabel(bytes, mediaType);
    if (!analysis.legible) {
      return fail("Couldn't read an ingredient list in that photo. Retake it closer, flat and well lit.", 422);
    }

    // Prefer fixed reference scores so the same ingredient always scores the same.
    const { data: refs, error: refError } = await db
      .from("ingredient_reference")
      .select("id, canonical_name, aliases, score");
    if (refError) return fail(`Reference lookup failed: ${refError.message}`, 500);

    const lookup = new Map<string, { id: string; score: number }>();
    for (const r of (refs ?? []) as RefRow[]) {
      const entry = { id: r.id, score: r.score };
      lookup.set(normalizeName(r.canonical_name), entry);
      for (const alias of r.aliases ?? []) lookup.set(normalizeName(alias), entry);
    }

    const rows = analysis.ingredients.map((ing, i) => {
      const hit =
        lookup.get(normalizeName(ing.canonical_name)) ?? lookup.get(normalizeName(ing.raw_name));
      const score = hit ? hit.score : ing.provisional_score;
      return {
        scan_id: id,
        position: i + 1,
        raw_name: ing.raw_name,
        reference_id: hit?.id ?? null,
        score,
        band: bandFor(score),
        reason: ing.reason,
        provisional: !hit,
      };
    });

    const overall = overallScore(rows.map((r) => ({ name: r.raw_name, score: r.score })));

    // A retry after a failed run must not collide with earlier rows.
    await db.from("scan_ingredients").delete().eq("scan_id", id);
    const inserted = await db.from("scan_ingredients").insert(rows);
    if (inserted.error) return fail(`Saving ingredients failed: ${inserted.error.message}`, 500);

    await db
      .from("scans")
      .update({
        product_name: analysis.product_name,
        overall_score: overall,
        allergens: analysis.allergens,
        status: "analyzed",
      })
      .eq("id", id);
    if (job) await db.from("jobs").update({ status: "done" }).eq("id", job.id);

    return NextResponse.json({ id });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Analysis failed.", 500);
  }
}

// Anything thrown before the inner try/catch (missing env vars) would otherwise
// come back as an empty 500 and break the browser's res.json().
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await handle((await params).id);
  } catch (err) {
    console.error("POST /api/scans/[id]/analyze failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected server error." },
      { status: 500 },
    );
  }
}
