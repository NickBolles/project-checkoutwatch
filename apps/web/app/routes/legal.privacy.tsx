import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getConfig } from "@checkoutwatch/core/server";
import { publicPageStyles } from "./public-page.css.js";

export const meta: MetaFunction = () => [
  { title: "CheckoutWatch — Privacy Policy" },
  { name: "robots", content: "index,follow" },
  {
    name: "description",
    content: "What CheckoutWatch stores, why, who it is shared with, and how long it is kept.",
  },
];

const LAST_UPDATED = "12 August 2026";

export function loader() {
  return { appUrl: getConfig().shopifyAppUrl };
}

export default function PrivacyPolicyRoute() {
  return <PrivacyPolicyPage data={useLoaderData<typeof loader>()} />;
}

export function PrivacyPolicyPage({ data }: { data: { appUrl: string } }) {
  const { appUrl } = data;
  return (
    <main className="cw-public">
      <style>{publicPageStyles}</style>
      <p className="brand">CHECKOUTWATCH</p>
      <h1>Privacy Policy</h1>
      <p className="meta">Last updated {LAST_UPDATED}</p>

      <p className="lede">
        CheckoutWatch monitors whether a Shopify store&rsquo;s checkout is working by running a
        short, automated walkthrough of it. This policy describes what that involves for data.
      </p>

      <div className="callout">
        <strong>We do not collect your customers&rsquo; personal information.</strong> Our test
        never enters an email address, shipping address, phone number, or payment details into any
        checkout field, and never completes an order. We do not read your order, customer, or
        payment records — the app does not request the API access that would allow it.
      </div>

      <h2>1. Who we are</h2>
      <p>
        CheckoutWatch is operated by the developer identified in our Shopify App Store listing.
        Contact: <a href="mailto:privacy@checkoutwatch.app">privacy@checkoutwatch.app</a>.
      </p>

      <h2>2. What we store about a merchant</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Store domain and storefront URL</td>
            <td>Identifies the account and tells the test which store to visit</td>
          </tr>
          <tr>
            <td>Shopify access token (encrypted at rest)</td>
            <td>
              Reads the product list so a monitor can be created, and detects theme changes that may
              explain a failure
            </td>
          </tr>
          <tr>
            <td>Subscription plan and billing status</td>
            <td>Applies plan limits; billing itself is handled by Shopify</td>
          </tr>
          <tr>
            <td>Monitor configuration</td>
            <td>The chosen product and how often to test it</td>
          </tr>
          <tr>
            <td>Alert destinations you enter</td>
            <td>
              Email addresses, Slack or Discord webhook URLs, and phone numbers you supply so we can
              notify you
            </td>
          </tr>
        </tbody>
      </table>

      <h2>3. What a test run records</h2>
      <p>Every run stores timing and outcome data. When a run fails, we additionally capture:</p>
      <ul>
        <li>A screenshot of the failing page of your own storefront or checkout</li>
        <li>Browser console warnings and errors from that page</li>
        <li>Network requests that failed, with their URLs and status codes</li>
        <li>
          The set of third-party script origins loaded, used to show what changed before a break
        </li>
      </ul>
      <p>
        These are diagnostic artifacts from pages our own automated browser visited. Because the
        test never signs in and never fills in a form, they should not contain customer data. If a
        store displays personal information on a product page or an unauthenticated checkout step,
        it could appear in a screenshot — tell us and we will delete the affected artifacts.
      </p>

      <h2>4. Access scopes</h2>
      <p>
        The app requests <code>read_products</code> and <code>read_themes</code> only. It cannot
        read orders, customers, or payment data, and it cannot write anything to your store.
      </p>

      <h2>5. Who we share data with</h2>
      <table>
        <thead>
          <tr>
            <th>Processor</th>
            <th>Purpose</th>
            <th>What it receives</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Resend</td>
            <td>Sending alert emails</td>
            <td>Your alert email address and the alert text</td>
          </tr>
          <tr>
            <td>Twilio (optional, Pro plan)</td>
            <td>Sending alert SMS</td>
            <td>Your alert phone number and the alert text</td>
          </tr>
          <tr>
            <td>Anthropic (optional)</td>
            <td>Plain-English diagnosis of a failure</td>
            <td>
              The failure code, console errors, and failed request URLs for that run. Disabled
              unless AI diagnosis is enabled on your plan; a deterministic non-AI diagnosis is used
              otherwise.
            </td>
          </tr>
          <tr>
            <td>Slack / Discord</td>
            <td>Delivering alerts</td>
            <td>Only what you send, to a webhook URL you provide</td>
          </tr>
        </tbody>
      </table>
      <p>We do not sell data, and we do not use it for advertising.</p>

      <h2>6. Public status pages</h2>
      <p>
        If you enable a public status page, it shows uptime percentages, incident times, and generic
        failure descriptions. Screenshots, console output, and diagnosis text are never published —
        public incident text is generated from failure categories so store internals cannot leak.
      </p>

      <h2>7. How long we keep it</h2>
      <p>
        Run history and artifacts are pruned on a schedule set by your plan. Artifacts attached to
        an incident are retained while that incident is retained. When you uninstall the app we
        immediately disable monitoring, cancel queued work, and delete the stored access token;
        remaining shop data is purged on the schedule above or on request.
      </p>

      <h2>8. Your rights</h2>
      <p>
        We support Shopify&rsquo;s mandatory data endpoints: a customer data request returns a
        summary of what we hold (which for customers is nothing), a customer redaction request is
        acknowledged, and a shop redaction request purges that shop&rsquo;s records. You may also
        email us directly to access, correct, export, or delete your data, or to object to
        processing. Depending on where you live, GDPR or CCPA rights may apply.
      </p>

      <h2>9. Security</h2>
      <p>
        Access tokens are encrypted at rest. All traffic uses HTTPS. Every incoming webhook is
        signature-verified and rejected if the signature does not match. Logs redact tokens,
        authorization headers, and secrets.
      </p>

      <h2>10. Changes</h2>
      <p>
        We will update the date at the top of this page when this policy changes, and notify
        merchants in-app for material changes.
      </p>

      <footer>
        <p className="meta">
          Contact <a href="mailto:privacy@checkoutwatch.app">privacy@checkoutwatch.app</a>. See also{" "}
          <a href={new URL("/bot", appUrl).toString()}>about our monitoring bot</a>.
        </p>
      </footer>
    </main>
  );
}
