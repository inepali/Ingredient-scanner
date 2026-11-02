import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import MediaUploader from "@/components/MediaUploader";

export const dynamic = "force-dynamic";

// Opened on the phone from the QR code. Upload only; analysis happens on the desktop.
export default async function PhoneUploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: scan } = await supabase().from("scans").select("id, status").eq("id", id).maybeSingle();
  if (!scan) notFound();

  if (scan.status === "analyzed") {
    return <p>This scan is already analyzed. Open it on your computer.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Add photos</h1>
        <p className="text-neutral-600">Photos appear on your computer automatically. Keep this page open.</p>
      </header>
      <MediaUploader scanId={id} />
    </div>
  );
}
