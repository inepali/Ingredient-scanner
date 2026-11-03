"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoScript } from "@/lib/script";
import { DEFAULT_TONE, TONES, type Tone } from "@/lib/tones";

const SECTION_CHIP: Record<string, { label: string; cls: string }> = {
  hook: { label: "Hook", cls: "bg-neutral-100 text-neutral-700" },
  good: { label: "The good", cls: "bg-green-100 text-green-800" },
  fair: { label: "So-so", cls: "bg-yellow-100 text-yellow-800" },
  poor: { label: "Watch out", cls: "bg-red-100 text-red-800" },
  outro: { label: "Question", cls: "bg-indigo-100 text-indigo-800" },
};

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
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE);

  // Remember the tone you like (a convenience only; fine if storage is unavailable).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("script-tone");
      if (saved && saved in TONES) setTone(saved as Tone);
    } catch {
      // ignore
    }
  }, []);
  function pickTone(t: Tone) {
    setTone(t);
    try {
      window.localStorage.setItem("script-tone", t);
    } catch {
      // ignore
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tone }),
      });
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
      <div className="space-y-1">
        <label htmlFor="tone" className="text-xs text-neutral-500">
          Tone
        </label>
        <select
          id="tone"
          value={tone}
          onChange={(e) => pickTone(e.target.value as Tone)}
          disabled={busy}
          className="w-full rounded-md border bg-white px-2 py-2 text-sm"
        >
          {(Object.keys(TONES) as Tone[]).map((t) => (
            <option key={t} value={t}>
              {TONES[t].label}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-500">{TONES[tone].prompt}</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {initial && (
        <div className="space-y-3">
          <p className="font-medium">{initial.title}</p>
          <ol className="space-y-3">
            {initial.scenes.map((s, i) => (
              <li key={i} className="rounded-lg border bg-white p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  {s.section && SECTION_CHIP[s.section] && (
                    <span className={`rounded-full px-2 py-0.5 font-medium ${SECTION_CHIP[s.section].cls}`}>
                      {SECTION_CHIP[s.section].label}
                    </span>
                  )}
                  <span>
                    Scene {i + 1} · {s.seconds}s{s.photo ? ` · photo ${s.photo}` : ""}
                  </span>
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
