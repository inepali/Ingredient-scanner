import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteMedia, mediaUrl, putMedia } from "@/lib/storage";
import { MAX_PRODUCT_IMAGES } from "@/lib/media";

export const runtime = "nodejs";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Vercel serverless requests are capped near 4.5 MB; the browser downsizes photos first.
const MAX_BYTES = 4 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

async function draftScan(id: string) {
  const { data } = await supabase().from("scans").select("id, status").eq("id", id).maybeSingle();
  return data;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { data, error } = await supabase()
      .from("scan_media")
      .select("id, kind, storage_path, sort_order")
      .eq("scan_id", id)
      .in("kind", ["label", "product_image"])
      .order("sort_order");
    if (error) return fail(error.message, 500);

    const media = await Promise.all(
      (data ?? []).map(async (m) => ({ id: m.id, kind: m.kind, url: await mediaUrl("images", m.storage_path) })),
    );
    return NextResponse.json({ media });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not load photos.", 500);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const scan = await draftScan(id);
    if (!scan) return fail("Scan not found.", 404);
    if (scan.status === "analyzed") return fail("This scan is already analyzed.", 409);

    const form = await req.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (kind !== "label" && kind !== "product_image") return fail("Unknown photo kind.", 400);
    if (!(file instanceof File) || file.size === 0) return fail("A photo is required.", 400);
    if (!ALLOWED_TYPES.includes(file.type)) return fail("Use a JPEG, PNG or WebP photo.", 400);
    if (file.size > MAX_BYTES) return fail("Photo is too large (max 4 MB).", 413);

    const db = supabase();
    const { data: existing } = await db
      .from("scan_media")
      .select("id, storage_path, sort_order")
      .eq("scan_id", id)
      .eq("kind", kind);
    const rows = existing ?? [];

    if (kind === "product_image" && rows.length >= MAX_PRODUCT_IMAGES) {
      return fail(`Up to ${MAX_PRODUCT_IMAGES} product photos.`, 409);
    }

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `scans/${id}/${kind}-${randomUUID()}.${ext}`;
    await putMedia("images", key, Buffer.from(await file.arrayBuffer()), file.type);

    const sortOrder = rows.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
    const { error } = await db.from("scan_media").insert({ scan_id: id, kind, storage_path: key, sort_order: sortOrder });
    if (error) return fail(`Saving photo failed: ${error.message}`, 500);

    // One label photo per scan: a new one replaces the old.
    if (kind === "label" && rows.length > 0) {
      await db.from("scan_media").delete().in("id", rows.map((r) => r.id));
      await Promise.allSettled(rows.map((r) => deleteMedia("images", r.storage_path)));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/scans/[id]/media failed:", err);
    return fail(err instanceof Error ? err.message : "Upload failed.", 500);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mediaId = new URL(req.url).searchParams.get("mediaId");
    if (!mediaId) return fail("mediaId is required.", 400);

    const scan = await draftScan(id);
    if (!scan) return fail("Scan not found.", 404);
    if (scan.status === "analyzed") return fail("This scan is already analyzed.", 409);

    const db = supabase();
    const { data: row } = await db
      .from("scan_media")
      .select("id, storage_path")
      .eq("id", mediaId)
      .eq("scan_id", id)
      .maybeSingle();
    if (!row) return fail("Photo not found.", 404);

    await db.from("scan_media").delete().eq("id", row.id);
    await deleteMedia("images", row.storage_path).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Delete failed.", 500);
  }
}
