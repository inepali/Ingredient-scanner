"use client";

import { useEffect, useRef, useState } from "react";

// Live camera preview in a modal; "Take photo" returns a JPEG File.
export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().then(() => setReady(true), () => {});
        }
      })
      .catch((e: unknown) => {
        const denied = e instanceof DOMException && e.name === "NotAllowedError";
        setError(denied ? "Camera access was blocked. Allow it in your browser's site settings." : "No camera found.");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "camera.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4">
      {error ? (
        <p className="max-w-sm rounded-xl bg-white p-4 text-sm text-red-700">{error}</p>
      ) : (
        <video ref={videoRef} playsInline muted className="max-h-[75vh] w-full max-w-xl rounded-lg bg-black" />
      )}
      <div className="flex gap-3">
        {!error && (
          <button
            onClick={snap}
            disabled={!ready}
            className="rounded-xl bg-white px-5 py-2 font-medium text-neutral-900 disabled:opacity-50"
          >
            Take photo
          </button>
        )}
        <button onClick={onClose} className="rounded-xl border border-white/40 px-5 py-2 text-white">
          {error ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
