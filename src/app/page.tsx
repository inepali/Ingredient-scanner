import AppShell from "@/components/AppShell";
import StartScan from "@/components/StartScan";

export default function Home() {
  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Ingredient Scanner</h1>
          <p className="text-neutral-600">Photo of the ingredient list in, 0–100 health report out.</p>
        </header>
        <StartScan />
      </div>
    </AppShell>
  );
}
