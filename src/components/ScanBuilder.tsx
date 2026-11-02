"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import MediaUploader from "./MediaUploader";
import { readJson } from "@/lib/image";
import type { MediaItem } from "@/lib/media";

export default function ScanBuilder({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [hasLabel, setHasLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<{ url: string; image: string; local: boolean } | null>(null);

  useEffect(() => {
    // The phone must be able to reach this address, so localhost won't work.
    // NEXT_PUBLIC_APP_URL overrides it (e.g. your deployed URL or LAN address).
    const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const url = `${base.replace(/\/$/, "")}/m/${scanId}`;
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
    QRCode.toDataURL(url, { width: 240, margin: 1 }).then((image) => setQr({ url, image, local }));
  }, [scanId]);

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
      <section className="flex items-center gap-4 rounded-lg border bg-white p-4">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.image} alt="QR code to upload photos from your phone" className="h-32 w-32 shrink-0" />
        ) : (
          <div className="h-32 w-32 shrink-0 rounded bg-neutral-100" />
        )}
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">Upload from your phone</p>
          <p className="text-neutral-600">Scan the QR code with your phone camera, then take or pick photos.</p>
          {qr && <p className="break-all text-xs text-neutral-400">{qr.url}</p>}
          {qr?.local && (
            <p className="text-xs text-amber-700">
              This address is localhost, which your phone can&apos;t open. Open this app via your computer&apos;s
              network IP (e.g. http://192.168.1.20:3000) or set NEXT_PUBLIC_APP_URL.
            </p>
          )}
        </div>
      </section>

      <MediaUploader scanId={scanId} onMedia={(m: MediaItem[]) => setHasLabel(m.some((x) => x.kind === "label"))} />

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        onClick={analyze}
        disabled={!hasLabel || busy}
        className="w-full rounded-md bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Analyzing… usually 10–20 seconds" : "Analyze label"}
      </button>
    </div>
  );
}
