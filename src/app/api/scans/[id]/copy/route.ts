import { supabase } from "@/lib/supabase";
import { NotReadyError, writeSocialCopy } from "@/lib/social";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Rewrites the TikTok and Instagram title, description and hashtags.
export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  try {
    return json(await writeSocialCopy(supabase(), id));
  } catch (err) {
    if (err instanceof NotReadyError) throw new HttpError(err.message, err.message.startsWith("Scan not") ? 404 : 400);
    throw err;
  }
});
