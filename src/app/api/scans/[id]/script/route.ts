import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createScript, offFactsLine, parseTone } from "@/lib/script";
import { getMedia } from "@/lib/storage";
import type { LlmImage } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { tone?: unknown };
  const tone = parseTone(body.tone);
  const db = supabase();

  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, status, overall_score, allergens, off_data")
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

  // Product photos, so the script describes what the product really looks like.
  const { data: photoRows } = await db
    .from("scan_media")
    .select("storage_path")
    .eq("scan_id", id)
    .eq("kind", "product_image")
    .order("sort_order")
    .limit(4);
  const photos: LlmImage[] = [];
  for (const row of photoRows ?? []) {
    try {
      const path = row.storage_path as string;
      const mediaType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
      photos.push({ data: await getMedia("images", path), mediaType });
    } catch {
      // a missing photo shouldn't block the script
    }
  }

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
      offFacts: offFactsLine(scan.off_data),
      photos,
      tone,
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
