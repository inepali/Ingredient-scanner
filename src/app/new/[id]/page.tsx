import AppShell from "@/components/AppShell";
import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LargeTitle from "@/components/LargeTitle";
import ScanBuilder from "@/components/ScanBuilder";

export const dynamic = "force-dynamic";

export default async function NewScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: scan } = await supabase().from("scans").select("id, status").eq("id", id).maybeSingle();
  if (!scan) notFound();
  if (scan.status === "analyzed") redirect(`/scans/${id}`);

  return (
    <AppShell>
    <div className="space-y-6">
      <LargeTitle title="New scan" subtitle="Add the ingredient label and 4–5 product photos, then analyze." />
      <ScanBuilder scanId={id} />
    </div>
    </AppShell>
  );
}
