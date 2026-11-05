"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Two-step delete: the first click asks, the second one deletes.
export default function DeleteScanButton({
  scanId,
  name,
  after,
}: {
  scanId: string;
  name: string | null;
  after: "history" | "refresh";
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not delete.");
      try {
        if (localStorage.getItem("last-scan") === scanId) localStorage.removeItem("last-scan");
      } catch {
        // fine
      }
      if (after === "history") router.push("/history");
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button
        className="shrink-0 rounded-md border px-3 py-2 text-sm text-red-700 hover:bg-red-50"
        onClick={() => setAsking(true)}
        aria-label={`Delete ${name ?? "this scan"}`}
      >
        Delete
      </button>
    );
  }
  return (
    <div className="shrink-0 space-y-1 text-sm" role="alertdialog" aria-label="Confirm delete">
      <p className="text-neutral-700">Delete {name ? `“${name}”` : "this scan"} and its photos, audio and videos?</p>
      <div className="flex gap-2">
        <button className="rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-40" disabled={busy} onClick={() => void remove()}>
          {busy ? "Deleting…" : "Yes, delete"}
        </button>
        <button className="rounded-md border px-3 py-1.5" disabled={busy} onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
