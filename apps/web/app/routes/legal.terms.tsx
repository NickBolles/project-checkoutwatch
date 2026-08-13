import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { PLANS } from "@checkoutwatch/core";
import { getConfig } from "@checkoutwatch/core/server";
import { publicPageStyles } from "./public-page.css.js";
import { SUPPORT_EMAIL } from "./public-contact.js";

export const meta: MetaFunction = () => [
  { title: "CheckoutWatch — Terms of Service" },
  { name: "robots", content: "index,follow" },
  {
    name: "description",
    content:
      "The terms under which CheckoutWatch is provided: what the service does, what it does not promise, billing, acceptable use, and termination.",
  },
];

const LAST_UPDATED = "13 August 2026";

/**
 * ⚠️ Draft. Written from what the code actually does -- the scopes it requests,
 * the traffic it generates, the plan limits in packages/core/src/plans.ts -- so
 * that it does not promise behaviour the product lacks. It has NOT been reviewed
 * by a lawyer, and the governing-law and liability sections in particular need a
 * real jurisdiction and a real entity name before this is published.
 */
export function loader() {
  return {
    appUrl: getConfig().shopifyAppUrl,
    trialDays: PLANS.growth.trialDays,
  };
}

export interface TermsData {
  appUrl: string;
  trialDays: number;
}

export default function TermsRoute() {
  return <TermsPage data={useLoaderData<typeof loader>()} />;
}

export function TermsPage({ data }: { data: TermsData }) {
  const { appUrl, trialDays } = data;
  return (
    <main className="cw-public">
      <style>{publicPageStyles}</style>
      <p className="brand">CHECKOUTWATCH</p>
      <h1>Terms of Service</h1>
      <p className="meta">Last updated {LAST_UPDATED}</p>

      <p className="lede">
        These terms govern your use of CheckoutWatch, a Shopify application that monitors whether a
        store&rsquo;s checkout is working. Installing the app means you accept them.
      </p>

      <div className="callout warn">
        <strong>Read section 4 before you rely on this.</strong> CheckoutWatch is a monitoring tool.
        It reduces how long a broken checkout goes unnoticed. It cannot prevent an outage, cannot
        guarantee it will detect every one, and must not be your only safeguard against lost sales.
      </div>

      <h2>1. Who these terms are between</h2>
      <p>
        &ldquo;CheckoutWatch&rdquo;, &ldquo;we&rdquo;, and &ldquo;us&rdquo; mean the developer
        identified in our Shopify App Store listing. &ldquo;You&rdquo; means the merchant that
        installs the app, acting through someone with authority to bind the business and with admin
        access to the store. If you install on behalf of a client, you confirm you are authorized to
        agree to these terms and to authorize the monitoring traffic described in section 3.
      </p>

      <h2>2. What the service is</h2>
      <p>
        CheckoutWatch periodically opens a product page on your storefront in an automated browser,
        adds the product to a cart, proceeds to checkout, and confirms that the payment step
        rendered. It records the result, and when checks fail repeatedly it opens an incident and
        sends alerts to the channels you configured.
      </p>
      <p>
        The app requests two read-only Shopify scopes, <code>read_products</code> and{" "}
        <code>read_themes</code>, and no others. It does not read your orders, customers, or payment
        records.
      </p>

      <h2>3. Monitoring traffic and your authorization</h2>
      <p>
        By creating a monitor you instruct us to send automated traffic to your own storefront, and
        you confirm you are entitled to authorize that traffic. This matters, so it is spelled out:
      </p>
      <ul>
        <li>
          A run <strong>never completes a purchase</strong>. It stops when the payment step is
          visible. No email address, shipping address, phone number, or payment detail is entered
          into any field, and no pay or complete-order control is clicked.
        </li>
        <li>
          We do not attempt to bypass a CAPTCHA, bot challenge, rate limit, or access control. If one
          blocks a run, we report it as a setup problem rather than an outage.
        </li>
        <li>
          Run frequency is floored by your plan, and the app enforces a minimum interval on manual
          runs, so monitoring cannot be turned into load against your store.
        </li>
        <li>
          Uninstalling stops all traffic immediately. You may also disable any monitor at any time.
        </li>
      </ul>
      <p>
        Details of how to identify, allowlist, or exclude this traffic are published at{" "}
        <a href={new URL("/bot", appUrl).toString()}>{new URL("/bot", appUrl).toString()}</a>.
      </p>

      <h2>4. What we do not promise</h2>
      <p>
        The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. In
        particular:
      </p>
      <ul>
        <li>
          <strong>We do not guarantee detection.</strong> A check exercises one product path at an
          interval you choose. A failure that occurs between runs, on a path we do not walk, or only
          for certain customers, regions, payment methods, or devices may not be detected at all.
        </li>
        <li>
          <strong>We do not guarantee delivery.</strong> Alerts depend on third-party email, SMS, and
          chat providers and on your own systems accepting them. We cannot guarantee an alert
          arrives, or arrives promptly.
        </li>
        <li>
          <strong>We do not guarantee accuracy.</strong> Checks can fail for reasons unrelated to
          your store, including our own network problems and changes to Shopify&rsquo;s checkout.
          Diagnosis text, including AI-generated diagnosis, is an aid to investigation and may be
          wrong. Do not act on it without confirming.
        </li>
        <li>
          <strong>We do not offer an uptime commitment</strong> for the monitoring service itself
          unless separately agreed in writing.
        </li>
      </ul>
      <p>
        You remain responsible for your storefront, your theme, your apps, and your payment
        configuration.
      </p>

      <h2>5. Plans, billing, and trials</h2>
      <p>
        Paid plans are billed through Shopify and appear on your regular Shopify invoice. Prices,
        monitor limits, check intervals, alert channels, and feature entitlements are as shown on our{" "}
        <a href={new URL("/home", appUrl).toString()}>overview page</a> and inside the app.
      </p>
      <ul>
        <li>Paid plans include a {trialDays}-day free trial unless stated otherwise.</li>
        <li>
          Subscriptions renew monthly until cancelled. Cancel from the Billing page in the app or
          by uninstalling.
        </li>
        <li>
          Charges are handled by Shopify and are governed by Shopify&rsquo;s billing terms, including
          its refund handling. We do not process your payment details.
        </li>
        <li>
          Downgrading disables monitors above the new plan&rsquo;s limit rather than deleting them,
          and applies that plan&rsquo;s minimum check interval.
        </li>
        <li>
          We may change prices with reasonable advance notice. Continuing to use a paid plan after a
          price change takes effect means you accept it.
        </li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          Point a monitor at a storefront you do not own or are not authorized to have tested. This
          is the term we enforce most strictly; monitors aimed at third-party stores are grounds for
          immediate termination.
        </li>
        <li>Use the service to generate load, or to probe or attack any system.</li>
        <li>
          Attempt to circumvent plan limits, frequency floors, or access controls, or to interfere
          with the service&rsquo;s operation or other merchants&rsquo; use of it.
        </li>
        <li>Resell or white-label the service without our written agreement.</li>
      </ul>

      <h2>7. Your data</h2>
      <p>
        What we store, why, who processes it, and how long it is kept are described in our{" "}
        <a href={new URL("/legal/privacy", appUrl).toString()}>privacy policy</a>, which forms part
        of these terms. Access tokens are encrypted at rest and deleted on uninstall.
      </p>

      <h2>8. Availability and changes to the service</h2>
      <p>
        We may modify, suspend, or discontinue any part of the service. For changes that materially
        reduce what a paid plan provides, we will give reasonable notice in-app or by email, and you
        may cancel. We may suspend an account immediately where use breaches section 6, where
        required by Shopify or by law, or where continued operation risks harm to a storefront.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the maximum extent permitted by law, we are not liable for lost sales, lost profits, lost
        data, or any indirect or consequential loss arising from use of the service &mdash; including
        an outage we failed to detect, an alert that did not arrive, and an alert that was wrong. Our
        total liability for any claim is limited to the fees you paid us in the three months before
        the claim arose.
      </p>
      <p>
        Nothing here excludes liability that cannot lawfully be excluded, and if you deal with us as
        a consumer, your statutory rights are unaffected.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may stop at any time by uninstalling the app. On uninstall we immediately disable
        monitoring, cancel queued runs, and delete the stored access token; remaining data is purged
        as described in the privacy policy. We may terminate for breach of these terms, and outside
        of breach we will give reasonable notice.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We will update the date at the top of this page when these terms change, and notify merchants
        in-app for material changes. Continuing to use the service after a change takes effect means
        you accept it.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These terms are governed by the law of the jurisdiction in which the developer identified in
        our App Store listing is established, and the courts of that jurisdiction have
        non-exclusive jurisdiction over any dispute. Your relationship with Shopify is governed
        separately by Shopify&rsquo;s own terms.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <footer>
        <p className="meta">
          <a href={new URL("/home", appUrl).toString()}>Overview</a> ·{" "}
          <a href={new URL("/support", appUrl).toString()}>Support</a> ·{" "}
          <a href={new URL("/legal/privacy", appUrl).toString()}>Privacy</a> ·{" "}
          <a href={new URL("/bot", appUrl).toString()}>About our bot</a>
        </p>
      </footer>
    </main>
  );
}
