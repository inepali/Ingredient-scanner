import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ScanBuilder from "@/components/ScanBuilder";

export const dynamic = "force-dynamic";

export default async function NewScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: scan } = await supabase().from("scans").select("id, status").eq("id", id).maybeSingle();
  if (!scan) notFound();
  if (scan.status === "analyzed") redirect(`/scans/${id}`);

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-neutral-500 underline">
        ← Home
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">New scan</h1>
        <p className="text-neutral-600">Add the ingredient label and 4–5 product photos, then analyze.</p>
      </header>
      <ScanBuilder scanId={id} />
    </div>
  );
}
