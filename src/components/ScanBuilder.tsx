"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MediaUploader from "./MediaUploader";
import BarcodeEntry from "./BarcodeEntry";
import { readJson } from "@/lib/image";
import type { MediaItem } from "@/lib/media";

export default function ScanBuilder({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [hasLabel, setHasLabel] = useState(false);
  const [hasBarcode, setHasBarcode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      await readJson(await fetch(`/api/scans/${scanId}/analyze`, { method: "POST" }));
      router.push(`/scans/${scanId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <MediaUploader scanId={scanId} onMedia={(m: MediaItem[]) => setHasLabel(m.some((x) => x.kind === "label"))} />

      <BarcodeEntry scanId={scanId} onFound={() => setHasBarcode(true)} />

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        onClick={analyze}
        disabled={!(hasLabel || hasBarcode) || busy}
        className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Analyzing… usually 10–20 seconds" : hasBarcode && !hasLabel ? "Analyze product" : "Analyze label"}
      </button>
    </div>
  );
}
