import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// Creates an empty draft scan. Photos are added via /api/scans/[id]/media and
// the label is analyzed via /api/scans/[id]/analyze.
export async function POST() {
  try {
    const { data, error } = await supabase().from("scans").insert({ status: "created" }).select("id").single();
    if (error || !data) {
      return NextResponse.json({ error: `Could not create scan: ${error?.message}` }, { status: 500 });
    }
    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error("POST /api/scans failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected server error." },
      { status: 500 },
    );
  }
}
