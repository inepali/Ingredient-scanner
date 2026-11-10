import Link from "next/link";

/** Phone-only top bar for a pushed screen (like an iOS navigation bar): "‹ History" and a small centred title. */
export default function NavBar({ title, backHref = "/history", backLabel = "History" }: { title: string; backHref?: string; backLabel?: string }) {
  return (
    <div className="sticky top-0 z-40 -mx-4 mb-3 grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b bg-[#f2f2f7]/85 px-2 backdrop-blur-xl sm:-mx-6 md:hidden">
      <Link href={backHref} className="flex min-h-11 items-center gap-0.5 text-[17px] text-accent">
        <svg viewBox="0 0 12 20" className="h-5 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 2 2 10l8 8" />
        </svg>
        {backLabel}
      </Link>
      <span className="max-w-[55vw] truncate text-[17px] font-semibold">{title}</span>
      <span />
    </div>
  );
}
