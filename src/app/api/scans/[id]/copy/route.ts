import { supabase } from "@/lib/supabase";
import { createCopy, mergeHashtags } from "@/lib/copy";
import { latestVideo } from "@/lib/queries";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { parseScript } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

// Writes the TikTok and Instagram title, description and hashtags.
export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = supabase();

  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, status, overall_score")
    .eq("id", id)
    .maybeSingle();
  if (!scan) throw new HttpError("Scan not found.", 404);
  if (scan.status !== "analyzed" || scan.overall_score === null) {
    throw new HttpError("Analyze the label first.");
  }

  const { data: ings } = await db
    .from("scan_ingredients")
    .select("raw_name, score")
    .eq("scan_id", id)
    .order("position");

  let scriptTitle: string | null = null;
  const video = await latestVideo(db, id);
  if (video?.script) {
    try {
      scriptTitle = parseScript(video.script).title;
    } catch {
      // unreadable script: copy is still fine without its title
    }
  }

  const { data: settings } = await db
    .from("settings")
    .select("curated_hashtags")
    .eq("id", 1)
    .maybeSingle();
  const curated: string[] = settings?.curated_hashtags ?? [];

  const result = await createCopy({
    productName: scan.product_name,
    overall: scan.overall_score,
    scriptTitle,
    ingredients: (ings ?? []).map((i) => ({ name: i.raw_name as string, score: (i.score as number | null) ?? 50 })),
  });
  result.tiktok.hashtags = mergeHashtags(result.tiktok.hashtags, curated);
  result.instagram.hashtags = mergeHashtags(result.instagram.hashtags, curated);

  await db.from("social_copy").delete().eq("scan_id", id);
  const saved = await db.from("social_copy").insert([
    { scan_id: id, platform: "tiktok", ...result.tiktok },
    { scan_id: id, platform: "instagram", ...result.instagram },
  ]);
  if (saved.error) throw new Error(`Saving post copy failed: ${saved.error.message}`);
  await db.from("jobs").insert({ scan_id: id, step: "copy", status: "done" });

  return json(result);
});
