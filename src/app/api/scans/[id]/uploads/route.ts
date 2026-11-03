import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { objectSize, presignUpload } from "@/lib/storage";
import { MAX_UPLOADS, MAX_UPLOAD_BYTES, videoTypeFor } from "@/lib/uploads";

export const runtime = "nodejs";

async function uploadCount(scanId: string) {
  const { count } = await supabase()
    .from("scan_media")
    .select("id", { count: "exact", head: true })
    .eq("scan_id", scanId)
    .eq("kind", "clip")
    .is("source_media_id", null);
  return count ?? 0;
}

// Step 1: the browser asks where to upload. The file then goes straight to R2.
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { filename?: string; contentType?: string; size?: number };
  const kind = videoTypeFor(body.filename ?? "", body.contentType ?? "");
  if (!kind) throw new HttpError("Use an MP4, MOV or WebM video.");
  if (!(Number(body.size) > 0)) throw new HttpError("The video looks empty.");
  if (Number(body.size) > MAX_UPLOAD_BYTES) throw new HttpError(`Video is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`, 413);
  const { data: scan } = await supabase().from("scans").select("id").eq("id", id).maybeSingle();
  if (!scan) throw new HttpError("Scan not found.", 404);
  if ((await uploadCount(id)) >= MAX_UPLOADS) throw new HttpError(`Up to ${MAX_UPLOADS} uploaded videos per scan.`, 409);

  const key = `scans/${id}/upload-${randomUUID()}.${kind.ext}`;
  return json({ key, contentType: kind.type, uploadUrl: await presignUpload("videos", key, kind.type) });
});

// Step 2: after the upload, the browser confirms and the video joins the scan.
export const PUT = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (typeof key !== "string" || !key.startsWith(`scans/${id}/upload-`) || key.includes("..")) throw new HttpError("Bad upload key.");
  const size = await objectSize("videos", key);
  if (size === null) throw new HttpError("The upload didn't arrive. Try again.", 400);
  if (size > MAX_UPLOAD_BYTES) throw new HttpError("Video is too large.", 413);

  const db = supabase();
  const { data: existing } = await db.from("scan_media").select("id").eq("scan_id", id).eq("storage_path", key).maybeSingle();
  if (existing) return json({ id: existing.id });
  const { data: last } = await db.from("scan_media").select("sort_order").eq("scan_id", id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("scan_media")
    .insert({ scan_id: id, kind: "clip", storage_path: key, sort_order: (last?.sort_order ?? -1) + 1 })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return json({ id: data.id });
});
