import type { Metadata } from "next";
import LegalPage, { CONTACT_EMAIL } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Foodie Scanner" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Foodie Scanner is a personal tool that scores the ingredients on packaged food labels and helps its owner make short
        educational videos about them. By using it or viewing its public report pages, you agree to these terms.
      </p>

      <h2>What the service is</h2>
      <p>
        You can scan a label photo or barcode and get an ingredient-by-ingredient score from 0 to 100 (100 is healthiest) and an overall
        score. The owner can turn a scan into a video and post it to their own TikTok, Instagram and YouTube accounts.
      </p>

      <h2>Not medical advice</h2>
      <p>
        Scores come from a general nutrition rubric, computer-assisted analysis and public product data. They are for general information
        only. They are not medical, dietary or allergy advice. Labels can be misread and product recipes change, so always check the
        package, and ask a qualified professional about your own health or allergies.
      </p>

      <h2>Accounts and access</h2>
      <ul>
        <li>The app is password protected and meant for its owner. Public report pages are the only part open to everyone.</li>
        <li>When the owner connects TikTok, Instagram or YouTube, the app acts only on that account, and only when the owner chooses to post.</li>
        <li>You must follow the terms of any platform you use with the app.</li>
      </ul>

      <h2>Third-party data</h2>
      <p>
        Product facts such as Nutri-Score, NOVA and Green-Score come from <a className="underline" href="https://world.openfoodfacts.org">Open Food Facts</a>{" "}
        and are available under the Open Database License. We do not guarantee that it is accurate or complete. Brand and product names
        belong to their owners.
      </p>

      <h2>No warranty and limits</h2>
      <p>
        The service is provided &quot;as is&quot;, without warranties of any kind. To the extent the law allows, the owner is not liable for losses
        that come from relying on a score, or from the service being unavailable or wrong.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will change the date above when we do. Questions: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
