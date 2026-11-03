"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Found = { barcode: string; name: string | null; brands: string | null };

// Minimal typing for the browser's built-in barcode reader (Chrome / Edge / Android).
type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * Identify a product by barcode instead of photographing a curved label.
 * Reads the code with the camera where the browser supports it, otherwise
 * you type the digits printed under the bars.
 */
export default function BarcodeEntry({ scanId, onFound }: { scanId: string; onFound?: (f: Found) => void }) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setCanScan("BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia));
    // Picks up a barcode looked up on the other device (phone <-> computer), and any saved earlier.
    const check = () =>
      fetch(`/api/scans/${scanId}/barcode`)
        .then((r) => r.json())
        .then((d: { barcode: string | null; name: string | null }) => {
          if (d.barcode) {
            const f = { barcode: d.barcode, name: d.name, brands: null };
            setFound(f);
            onFound?.(f);
          }
        })
        .catch(() => {});
    void check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);
  useEffect(() => stop, [stop]);

  const lookup = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/scans/${scanId}/barcode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode: value }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<Found> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Lookup failed.");
        const f = { barcode: data.barcode ?? value, name: data.name ?? null, brands: data.brands ?? null };
        setFound(f);
        onFound?.(f);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lookup failed.");
      } finally {
        setBusy(false);
      }
    },
    [scanId, onFound],
  );

  async function startCamera() {
    setError(null);
    try {
      const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
      const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      // Wait for the <video> to mount.
      await new Promise((r) => setTimeout(r, 50));
      const video = videoRef.current;
      if (!video) return stop();
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const hits = await detector.detect(video);
          const value = hits[0]?.rawValue;
          if (value) {
            stop();
            setCode(value);
            void lookup(value);
            return;
          }
        } catch {
          // keep trying
        }
        setTimeout(tick, 250);
      };
      void tick();
    } catch (e) {
      stop();
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was denied." : "Couldn't start the camera. Type the number instead.");
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <p className="font-medium">Scan the barcode instead</p>
        <p className="text-sm text-neutral-600">
          Hard to photograph a curved label? The barcode finds the product and its ingredient list on Open Food Facts.
        </p>
      </div>

      {scanning && (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="aspect-video w-full rounded-md bg-black object-cover" />
          <button className="text-sm underline" onClick={stop}>Cancel</button>
        </div>
      )}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(code);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
          inputMode="numeric"
          placeholder="Digits under the barcode"
          aria-label="Barcode number"
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
        />
        <button type="submit" disabled={busy || code.replace(/\D/g, "").length < 8} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {busy ? "Looking up…" : "Look up"}
        </button>
        {canScan && !scanning && (
          <button type="button" disabled={busy} onClick={() => void startCamera()} className="rounded-md border px-4 py-2 text-sm">
            Use camera
          </button>
        )}
      </form>
      {!canScan && (
        <p className="text-xs text-neutral-500">
          This browser can&apos;t read barcodes with the camera (iPhone Safari can&apos;t yet). Type the digits, or open this page in Chrome on Android.
        </p>
      )}

      {found && (
        <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          Found {found.name ? <strong>{found.name}</strong> : "the product"}
          {found.brands ? ` (${found.brands.split(",")[0]})` : ""}, barcode {found.barcode}. Ready to analyze.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
