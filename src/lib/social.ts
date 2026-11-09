import type { SupabaseClient } from "@supabase/supabase-js";
import { createCopy, mergeHashtags, type CopyResult } from "./copy.ts";
import { latestVideo } from "./queries.ts";
import { offFactsLine, parseScript } from "./script.ts";

export class NotReadyError extends Error {}

/**
 * Writes the TikTok, Instagram and YouTube title, description and hashtags for a scan
 * and saves them (replacing any earlier copy). Used by the Rewrite button and
 * automatically after a video is rendered.
 */
export async function writeSocialCopy(db: SupabaseClient, scanId: string): Promise<CopyResult> {
  const { data: scan } = await db
    .from("scans")
    .select("id, product_name, status, overall_score, off_data")
    .eq("id", scanId)
    .maybeSingle();
  if (!scan) throw new NotReadyError("Scan not found.");
  if (scan.status !== "analyzed" || scan.overall_score === null) {
    throw new NotReadyError("Analyze the label first.");
  }

  const { data: ings } = await db
    .from("scan_ingredients")
    .select("raw_name, score")
    .eq("scan_id", scanId)
    .order("position");

  let scriptTitle: string | null = null;
  const video = await latestVideo(db, scanId);
  if (video?.script) {
    try {
      scriptTitle = parseScript(video.script).title;
    } catch {
      // unreadable script: copy is still fine without its title
    }
  }

  const { data: settings } = await db.from("settings").select("curated_hashtags").eq("id", 1).maybeSingle();
  const curated: string[] = settings?.curated_hashtags ?? [];

  const result = await createCopy({
    productName: scan.product_name,
    overall: scan.overall_score,
    scriptTitle,
    offFacts: offFactsLine(scan.off_data),
    ingredients: (ings ?? []).map((i) => ({ name: i.raw_name as string, score: (i.score as number | null) ?? 50 })),
  });
  result.tiktok.hashtags = mergeHashtags(result.tiktok.hashtags, curated);
  result.instagram.hashtags = mergeHashtags(result.instagram.hashtags, curated);
  result.youtube.hashtags = mergeHashtags(result.youtube.hashtags, curated, 20);

  await db.from("social_copy").delete().eq("scan_id", scanId);
  const saved = await db.from("social_copy").insert([
    { scan_id: scanId, platform: "tiktok", ...result.tiktok },
    { scan_id: scanId, platform: "instagram", ...result.instagram },
    { scan_id: scanId, platform: "youtube", ...result.youtube },
  ]);
  if (saved.error) throw new Error(`Saving post copy failed: ${saved.error.message}`);
  await db.from("jobs").insert({ scan_id: scanId, step: "copy", status: "done" });

  return result;
}
