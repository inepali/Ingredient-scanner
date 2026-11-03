import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";

export const runtime = "nodejs";

// Sets (or clears) the product name, or turns the public report page on or off.
export const PATCH = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { product_name?: unknown; is_public?: unknown };

  if (typeof body.is_public === "boolean") {
    const { data, error } = await supabase().from("scans").update({ is_public: body.is_public }).eq("id", id).select("is_public").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError("Scan not found.", 404);
    return json({ is_public: data.is_public });
  }

  if (typeof body.product_name !== "string") throw new HttpError("product_name must be text.");
  const name = body.product_name.replace(/\s+/g, " ").trim();
  if (name.length > 120) throw new HttpError("Keep the name under 120 characters.");

  const { data, error } = await supabase()
    .from("scans")
    .update({ product_name: name || null })
    .eq("id", id)
    .select("product_name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError("Scan not found.", 404);
  return json({ product_name: data.product_name });
});
