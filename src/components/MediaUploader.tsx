"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downscale, readJson } from "@/lib/image";
import { MAX_PRODUCT_IMAGES, type MediaItem } from "@/lib/media";
import CameraCapture from "./CameraCapture";

// Label + product photo slots for one scan. Used on the desktop page and on the
// phone page (opened from the QR code); both poll, so photos added on the phone
// show up on the desktop within a few seconds.
export default function MediaUploader({
  scanId,
  onMedia,
}: {
  scanId: string;
  onMedia?: (media: MediaItem[]) => void;
}) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<MediaItem["kind"] | null>(null);
  // Phones over plain http have no getUserMedia; their file input's capture attribute opens the camera instead.
  const captureInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const onMediaRef = useRef(onMedia);
  onMediaRef.current = onMedia;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${scanId}/media`, { cache: "no-store" });
      const json = await readJson<{ media: MediaItem[]; error?: string }>(res);
      setMedia(json.media);
      onMediaRef.current?.(json.media);
    } catch {
      // keep what we have; the next poll will retry
    }
  }, [scanId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  function openCamera(kind: MediaItem["kind"]) {
    if (window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function") setCamera(kind);
    else captureInputs.current[kind]?.click();
  }

  async function upload(kind: MediaItem["kind"], files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const blob = await downscale(file);
        const body = new FormData();
        body.set("kind", kind);
        body.set("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        await readJson(await fetch(`/api/scans/${scanId}/media`, { method: "POST", body }));
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(mediaId: string) {
    setError(null);
    try {
      await readJson(await fetch(`/api/scans/${scanId}/media?mediaId=${mediaId}`, { method: "DELETE" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  const label = media.find((m) => m.kind === "label");
  const products = media.filter((m) => m.kind === "product_image");

  const btn = "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50";
  const primary = `${btn} bg-neutral-900 text-white`;
  const secondary = `${btn} border border-neutral-300 bg-white text-neutral-900`;

  function pickers(kind: MediaItem["kind"], disabled: boolean, multiple: boolean) {
    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      upload(kind, e.target.files);
      e.target.value = "";
    };
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => openCamera(kind)} className={primary}>
          Use Camera
        </button>
        <label className={`${secondary} cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`}>
          {multiple ? "Choose Files" : "Choose File"}
          <input type="file" accept="image/*" multiple={multiple} disabled={disabled} onChange={onChange} className="hidden" />
        </label>
        <input
          ref={(el) => {
            captureInputs.current[kind] = el;
          }}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={onChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">1. Ingredient label photo (required)</h2>
        {pickers("label", busy, false)}
        {label && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={label.url} alt="Ingredient label" className="max-h-72 w-full rounded-lg border bg-white object-contain" />
            <button onClick={() => remove(label.id)} className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
              Remove
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          2. Product photos for the video ({products.length}/{MAX_PRODUCT_IMAGES})
        </h2>
        {pickers("product_image", busy || products.length >= MAX_PRODUCT_IMAGES, true)}
        {products.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {products.map((p) => (
              <li key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Product" className="aspect-square w-full rounded-lg border bg-white object-cover" />
                <button onClick={() => remove(p.id)} aria-label="Remove photo" className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {camera && (
        <CameraCapture
          onCapture={(file) => {
            const kind = camera;
            setCamera(null);
            upload(kind, [file]);
          }}
          onClose={() => setCamera(null)}
        />
      )}

      {busy && <p className="text-sm text-neutral-500">Uploading…</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
