"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoScript } from "@/lib/script";

export default function ScriptSection({
  scanId,
  initial,
}: {
  scanId: string;
  initial: VideoScript | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/script`, { method: "POST" });
      const raw = await res.text();
      let json: { error?: string } = {};
      try {
        json = raw ? (JSON.parse(raw) as typeof json) : {};
      } catch {
        // non-JSON body; fall through to the status message
      }
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Video script</h2>
        <button
          onClick={create}
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Writing…" : initial ? "Rewrite script" : "Create Script"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {initial && (
        <div className="space-y-3">
          <p className="font-medium">{initial.title}</p>
          <ol className="space-y-3">
            {initial.scenes.map((s, i) => (
              <li key={i} className="rounded-lg border bg-white p-3 text-sm">
                <p className="text-xs text-neutral-500">
                  Scene {i + 1} · {s.seconds}s
                </p>
                <p className="mt-1">
                  <span className="font-medium">Visual:</span> {s.visual}
                </p>
                <p className="mt-1">
                  <span className="font-medium">Voiceover:</span> {s.voiceover}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
