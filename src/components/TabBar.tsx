"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icon = "h-7 w-7";

/** Phone-only bottom tab bar for the top-level screens (like iOS): Scan and History. */
export default function TabBar() {
  const path = usePathname() ?? "";
  const onHistory = path.startsWith("/history");
  const onScan = path === "/" || path.startsWith("/new");
  const item = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 pt-1.5 text-[10px] font-medium ${active ? "text-accent" : "text-neutral-500"}`;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <Link href="/" className={item(onScan)} aria-current={onScan ? "page" : undefined}>
        <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth={onScan ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <path d="M7 12h10" />
        </svg>
        Scan
      </Link>
      <Link href="/history" className={item(onHistory)} aria-current={onHistory ? "page" : undefined}>
        <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth={onHistory ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        History
      </Link>
    </nav>
  );
}
