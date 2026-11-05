import { finishConnect } from "@/lib/social-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return finishConnect(req, "youtube");
}
