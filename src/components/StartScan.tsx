"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readJson } from "@/lib/image";

export default function StartScan() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const json = await readJson<{ id: string; error?: string }>(await fetch("/api/scans", { method: "POST" }));
      router.push(`/new/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-2xl bg-accent px-4 py-4 text-[17px] font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Starting…" : "New scan"}
      </button>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
