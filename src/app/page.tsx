import AppShell from "@/components/AppShell";
import LargeTitle from "@/components/LargeTitle";
import StartScan from "@/components/StartScan";

export default function Home() {
  return (
    <AppShell>
      <div className="space-y-6">
        <LargeTitle title="Scan" subtitle="Photo of the ingredient list in, 0–100 health report out." />
        <StartScan />
      </div>
    </AppShell>
  );
}
