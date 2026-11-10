import AppShell from "@/components/AppShell";
import LargeTitle from "@/components/LargeTitle";
import ScanBuilder from "@/components/ScanBuilder";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DRAFT_MAX_AGE_MS = 12 * 3600_000;

/**
 * Home is the new-scan screen itself: it picks up your latest unfinished draft (so a reload or a
 * trip to History doesn't lose photos) or starts a fresh one.
 */
export default async function Home() {
  const db = supabase();
  const since = new Date(Date.now() - DRAFT_MAX_AGE_MS).toISOString();
  const { data: draft } = await db
    .from("scans")
    .select("id")
    .eq("status", "created")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let id = draft?.id as string | undefined;
  if (!id) {
    const { data, error } = await db.from("scans").insert({ status: "created" }).select("id").single();
    if (error || !data) throw new Error(`Could not start a scan: ${error?.message}`);
    id = data.id as string;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <LargeTitle title="Foodie Scanner" subtitle="Scan a label or barcode to see what’s really in your food." />
        <ScanBuilder scanId={id} />
      </div>
    </AppShell>
  );
}
