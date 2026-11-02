import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createScript } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();

  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, status, overall_score, allergens")
    .eq("id", id)
    .maybeSingle();
  if (!scan || scan.status !== "analyzed" || scan.overall_score === null) {
    return NextResponse.json({ error: "Scan not found or not analyzed yet." }, { status: 404 });
  }

  const { data: ings } = await db
    .from("scan_ingredients")
    .select("raw_name, score, reason")
    .eq("scan_id", id)
    .order("position");

  const { data: job } = await db
    .from("jobs")
    .insert({ scan_id: id, step: "script", status: "running" })
    .select("id")
    .single();

  try {
    const script = await createScript({
      productName: scan.product_name,
      overall: scan.overall_score,
      allergens: scan.allergens ?? [],
      ingredients: (ings ?? []).map((i) => ({ name: i.raw_name, score: i.score, reason: i.reason })),
    });

    const { data: last } = await db
      .from("videos")
      .select("version")
      .eq("scan_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db
      .from("videos")
      .insert({ scan_id: id, script: JSON.stringify(script), version: (last?.version ?? 0) + 1 });
    if (error) throw new Error(`Saving script failed: ${error.message}`);

    if (job) await db.from("jobs").update({ status: "done" }).eq("id", job.id);
    return NextResponse.json({ script });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script generation failed.";
    if (job) await db.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
