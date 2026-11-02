import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { analyzeLabel } from "@/lib/analyze";
import { bandFor, normalizeName, overallScore } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Vercel serverless requests are capped near 4.5 MB; the browser downsizes the photo first.
const MAX_BYTES = 4 * 1024 * 1024;

type RefRow = { id: string; canonical_name: string; aliases: string[] | null; score: number };

export async function POST(req: Request) {
  const form = await req.formData();
  const label = form.get("label");

  if (!(label instanceof File) || label.size === 0) {
    return NextResponse.json({ error: "A label photo is required." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(label.type)) {
    return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  }
  if (label.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo is too large (max 4 MB)." }, { status: 413 });
  }

  const db = supabase();

  const { data: scan, error: scanError } = await db
    .from("scans")
    .insert({ status: "analyzing" })
    .select("id")
    .single();
  if (scanError || !scan) {
    return NextResponse.json({ error: `Could not create scan: ${scanError?.message}` }, { status: 500 });
  }
  const scanId: string = scan.id;

  const { data: job } = await db
    .from("jobs")
    .insert({ scan_id: scanId, step: "analyze", status: "running" })
    .select("id")
    .single();

  const fail = async (message: string, status: number) => {
    await db.from("scans").update({ status: "failed" }).eq("id", scanId);
    if (job) await db.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
    return NextResponse.json({ error: message }, { status });
  };

  try {
    const bytes = Buffer.from(await label.arrayBuffer());

    // Keep the original label photo.
    const ext = label.type === "image/png" ? "png" : label.type === "image/webp" ? "webp" : "jpg";
    const path = `scans/${scanId}/label.${ext}`;
    const upload = await db.storage.from("media").upload(path, bytes, { contentType: label.type });
    if (upload.error) return fail(`Storage upload failed: ${upload.error.message}`, 500);
    await db.from("scan_media").insert({ scan_id: scanId, kind: "label", storage_path: path });

    // Ask Claude to read and rate the ingredients.
    const analysis = await analyzeLabel(bytes, label.type);
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
        scan_id: scanId,
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
      .eq("id", scanId);
    if (job) await db.from("jobs").update({ status: "done" }).eq("id", job.id);

    return NextResponse.json({ id: scanId });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Analysis failed.", 500);
  }
}
