import { HttpError, handler } from "@/lib/http";
import { isPlatform } from "@/lib/social-platforms";
import { startConnect } from "@/lib/social-oauth";

export const runtime = "nodejs";

// GET /api/social/connect?platform=tiktok|instagram → redirects to the platform's sign-in page.
export const GET = handler(async (req) => {
  const platform = new URL(req.url).searchParams.get("platform");
  if (!isPlatform(platform)) throw new HttpError("Unknown platform.");
  return startConnect(req, platform);
});
