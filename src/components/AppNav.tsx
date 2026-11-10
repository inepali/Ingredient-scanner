"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const KEY = "last-scan";
const link = "rounded-lg px-1 py-1 md:px-3 md:py-2";

/**
 * The app-wide part of the sidebar: New scan, History and a way back to the
 * scan you were on. On a scan page pass its id so it's remembered for later.
 */
export default function AppNav({ scanId }: { scanId?: string }) {
  const path = usePathname() ?? "";
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (scanId) localStorage.setItem(KEY, scanId);
      else setLast(localStorage.getItem(KEY));
    } catch {
      // storage can be unavailable; the button just won't show
    }
  }, [scanId]);

  const onNew = path === "/" || path.startsWith("/new");
  const onHistory = path.startsWith("/history");
  const cls = (active: boolean) =>
    `${link} ${active ? "bg-accent font-medium text-white" : "text-neutral-600 hover:text-neutral-900 md:hover:bg-neutral-100"}`;

  return (
    <div className={`mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm md:mb-3 md:flex-col md:items-stretch md:gap-0.5 ${scanId ? "md:border-b md:pb-3" : ""}`}>
      <Link href="/" className={cls(onNew)} aria-current={onNew ? "page" : undefined}>
        + New scan
      </Link>
      <Link href="/history" className={cls(onHistory)} aria-current={onHistory ? "page" : undefined}>
        History
      </Link>
      {!scanId && last && (
        <Link href={`/scans/${last}`} className="rounded-lg border px-3 py-1.5 text-center text-neutral-700 hover:bg-neutral-100 md:mt-2">
          ← Back to scan
        </Link>
      )}
    </div>
  );
}
