"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shows the product name the AI found, or lets you type one when it couldn't.
export default function ProductName({ scanId, initial }: { scanId: string; initial: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; product_name?: string | null };
      if (!res.ok) throw new Error(data.error ?? "Could not save the name.");
      setName(data.product_name ?? "");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the name.");
    } finally {
      setSaving(false);
    }
  }

  const missing = !initial;
  if (editing || missing) {
    return (
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {missing && !editing && (
          <p className="text-xs text-neutral-500">Couldn&apos;t find the product name on the label. Add it:</p>
        )}
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Product name, e.g. Oreo Original"
            aria-label="Product name"
            className="w-full min-w-0 rounded-md border px-3 py-1.5 text-lg"
          />
          <button type="submit" disabled={saving || !name.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {saving ? "Saving…" : "Save"}
          </button>
          {editing && (
            <button type="button" className="text-sm underline" onClick={() => { setName(initial ?? ""); setEditing(false); }}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </form>
    );
  }
  return (
    <h1 className="flex items-baseline gap-2 text-2xl font-semibold">
      {initial}
      <button className="text-xs font-normal text-neutral-500 underline" onClick={() => setEditing(true)}>
        Edit
      </button>
    </h1>
  );
}
