import Link from "next/link";

export const LEGAL_UPDATED = "November 6, 2026";
export const CONTACT_EMAIL = "sanjayaghimire@gmail.com";

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="space-y-4 text-sm leading-relaxed text-neutral-700 [&_h2]:pt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-neutral-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
      <p className="text-xs text-neutral-500">Last updated {LEGAL_UPDATED}</p>
      {children}
      <p className="pt-4 text-xs text-neutral-500">
        <Link href="/terms" className="underline">Terms of Service</Link> · <Link href="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </article>
  );
}
