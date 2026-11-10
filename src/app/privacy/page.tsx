import type { Metadata } from "next";
import LegalPage, { CONTACT_EMAIL } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Foodie Scanner" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Foodie Scanner is a personal tool run by its owner. This page explains what information it handles. In short: it does not sell
        data, does not track visitors and has no advertising.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Label photos, barcodes, product names, ingredient scores, scripts, voiceovers and videos the owner creates.</li>
        <li>Videos the owner uploads, and the finished videos and captions.</li>
        <li>If the owner connects TikTok, Instagram or YouTube: the account name and the access tokens needed to post. Tokens are encrypted at rest.</li>
      </ul>
      <p>We do not collect personal information about visitors to public report pages, and we do not use analytics or advertising cookies.</p>

      <h2>How TikTok, Instagram and YouTube data is used</h2>
      <ul>
        <li>We ask only for the permissions needed to identify the connected account and to upload the owner&apos;s own videos to it.</li>
        <li>We do not read your followers, messages or other people&apos;s content, and we do not share this data with anyone.</li>
        <li>
          Use of YouTube data follows the <a className="underline" href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and the{" "}
          <a className="underline" href="https://policies.google.com/privacy">Google Privacy Policy</a>.
        </li>
      </ul>

      <h2>Services that process data for us</h2>
      <p>To do its job the app sends the minimum needed to these providers:</p>
      <ul>
        <li>Supabase (database) and Cloudflare R2 (file storage), where scans, images and videos are kept.</li>
        <li>An AI language model provider (Google Gemini or Anthropic Claude) that reads ingredient text and writes scripts and captions.</li>
        <li>ElevenLabs (voiceover) and fal (video clips), which receive the script text or product photos.</li>
        <li>Open Food Facts, which receives a barcode or product name to look up product information.</li>
        <li>Vercel, which hosts the app.</li>
      </ul>

      <h2>Public report pages</h2>
      <p>A scan&apos;s report page is public only when the owner switches it on. It shows the product, scores and ingredient breakdown. Turning it off makes the link stop working.</p>

      <h2>Your choices and deletion</h2>
      <ul>
        <li>The owner can disconnect any account in the app, which deletes the stored tokens, and can delete any scan and its files.</li>
        <li>You can also remove access at any time from TikTok, Instagram or Google account settings (Security → Third-party access).</li>
        <li>To ask us to delete anything about you, email <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
      </ul>

      <h2>Children</h2>
      <p>The service is not directed at children under 13 and does not knowingly collect their information.</p>

      <h2>Changes and contact</h2>
      <p>
        We will update the date above when this policy changes. Contact: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
