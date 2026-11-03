import { supabase } from "@/lib/supabase";
import { HttpError, handler, json, paramId } from "@/lib/http";
import { fetchByBarcode, isValidBarcode } from "@/lib/openfoodfacts";

export const runtime = "nodejs";
export const maxDuration = 30;

// Looks a scanned barcode up on Open Food Facts and, if it has an ingredient list,
// saves the barcode on the scan so "Analyze" can use it instead of a label photo.
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const body = (await req.json().catch(() => ({}))) as { barcode?: unknown };
  const code = typeof body.barcode === "string" ? body.barcode.replace(/\D/g, "") : "";
  if (!isValidBarcode(code)) {
    throw new HttpError("That doesn't look like a valid barcode. Check the digits under the bars (8, 12 or 13 digits).");
  }

  const db = supabase();
  const { data: scan } = await db.from("scans").select("id, status, product_name").eq("id", id).maybeSingle();
  if (!scan) throw new HttpError("Scan not found.", 404);
  if (scan.status === "analyzed") throw new HttpError("This scan is already analyzed.", 409);

  const found = await fetchByBarcode(code);
  if (!found) throw new HttpError("Open Food Facts doesn't know this product yet. Photograph the ingredient label instead.", 404);
  if (!found.ingredientsText) {
    throw new HttpError(`Found "${found.summary.name ?? code}" but it has no ingredient list on Open Food Facts. Photograph the label instead.`, 422);
  }

  const name = found.summary.name ? [found.summary.brands?.split(",")[0]?.trim(), found.summary.name].filter(Boolean).join(" ") : null;
  const { error } = await db
    .from("scans")
    .update({ off_code: code, off_ingredients: found.ingredientsText, ...(name && !scan.product_name ? { product_name: name } : {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return json({ barcode: code, name: found.summary.name, brands: found.summary.brands, ingredients: found.ingredientsText });
});

// The barcode already saved on this scan (the phone page and the desktop page share it).
export const GET = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const { data } = await supabase().from("scans").select("off_code, product_name, off_ingredients").eq("id", id).maybeSingle();
  return json({ barcode: data?.off_code ?? null, name: data?.product_name ?? null, ingredients: data?.off_ingredients ?? null });
});
