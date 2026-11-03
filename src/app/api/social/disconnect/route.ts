import { HttpError, handler, json } from "@/lib/http";
import { isPlatform } from "@/lib/social-platforms";
import { removeAccount, requireGuard } from "@/lib/social-accounts";

export const runtime = "nodejs";

export const POST = handler(async (req) => {
  requireGuard();
  const { platform } = (await req.json().catch(() => ({}))) as { platform?: string };
  if (!isPlatform(platform)) throw new HttpError("Unknown platform.");
  await removeAccount(platform);
  return json({ ok: true });
});
