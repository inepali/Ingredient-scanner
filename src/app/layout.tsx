import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ingredient Scanner",
  description: "Label photo in, health report and 60s social video out.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-2xl p-6">{children}</main>
      </body>
    </html>
  );
}
