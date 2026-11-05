import type { ReactNode } from "react";
import AppNav from "./AppNav";

/** Sidebar (New scan, History, back to scan) with the page's content on the right. No scan steps here. */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div data-wide className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      <nav aria-label="Main" className="md:sticky md:top-6 md:w-52 md:shrink-0">
        <AppNav />
      </nav>
      <div className="min-w-0 max-w-2xl flex-1">{children}</div>
    </div>
  );
}
