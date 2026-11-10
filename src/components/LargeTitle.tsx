/** iOS-style large title with an optional grey subtitle. */
export default function LargeTitle({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <header className="space-y-1 pt-2">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight">{title}</h1>
      {subtitle && <p className="text-[15px] text-neutral-500">{subtitle}</p>}
    </header>
  );
}
