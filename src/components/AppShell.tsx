import type { ReactNode } from "react";
import AppNav from "./AppNav";
import TabBar from "./TabBar";

/** Desktop: sidebar (New scan, History, back to scan). Phone: a bottom tab bar (Scan, History). No scan steps here. */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div data-wide className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      <nav aria-label="Main" className="hidden md:sticky md:top-6 md:block md:w-52 md:shrink-0">
        <AppNav />
      </nav>
      <div className="min-w-0 max-w-2xl flex-1">{children}</div>
      <TabBar />
    </div>
  );
}
