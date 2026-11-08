import { supabase } from "@/lib/supabase";
import { cleanLines } from "@/lib/custom-lines";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";

// Your reusable voiceover lines (hooks, references, catchphrases).
export const GET = handler(async () => {
  const { data } = await supabase().from("settings").select("custom_lines").eq("id", 1).maybeSingle();
  return json({ lines: cleanLines(data?.custom_lines) });
});

export const PUT = handler(async (req) => {
  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null;
  if (!body || !Array.isArray(body.lines)) throw new HttpError("Send { lines: [...] }.");
  const lines = cleanLines(body.lines);
  const { error } = await supabase().from("settings").upsert({ id: 1, custom_lines: lines });
  if (error) throw new Error(`Saving your lines failed: ${error.message}`);
  return json({ lines });
});
