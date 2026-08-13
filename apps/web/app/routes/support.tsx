import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getConfig } from "@checkoutwatch/core/server";
import { publicPageStyles } from "./public-page.css.js";
import { SUPPORT_EMAIL, SUPPORT_HOURS, SUPPORT_RESPONSE_TARGET } from "./public-contact.js";

export const meta: MetaFunction = () => [
  { title: "CheckoutWatch — Support" },
  { name: "robots", content: "index,follow" },
  {
    name: "description",
    content:
      "How to get help with CheckoutWatch: contact details, response times, what to include in a report, and answers to the questions merchants ask most.",
  },
];

/**
 * The support URL on the App Store listing. Shopify requires a reachable support
 * contact, and reviewers check that the page states how to reach a human rather
 * than only linking documentation.
 */
export function loader() {
  return { appUrl: getConfig().shopifyAppUrl };
}

export interface SupportData {
  appUrl: string;
}

export default function SupportRoute() {
  return <SupportPage data={useLoaderData<typeof loader>()} />;
}

export function SupportPage({ data }: { data: SupportData }) {
  const { appUrl } = data;
  return (
    <main className="cw-public">
      <style>{publicPageStyles}</style>
      <p className="brand">CHECKOUTWATCH</p>
      <h1>Support</h1>
      <p className="lede">
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We answer within{" "}
        {SUPPORT_RESPONSE_TARGET}, {SUPPORT_HOURS}.
      </p>

      <div className="callout">
        <strong>If CheckoutWatch is paging you about an outage that is not real</strong>, say so in
        the subject line. False alerts are treated as a defect in the product, not a support
        question, and they go to the front of the queue.
      </div>

      <h2>What to include</h2>
      <p>These four things let us answer on the first reply instead of the third:</p>
      <ul>
        <li>Your <code>.myshopify.com</code> store domain.</li>
        <li>The monitor or incident link from inside the app, if the problem is a specific run.</li>
        <li>What you expected to happen, and what happened instead.</li>
        <li>Roughly when it happened, with a timezone.</li>
      </ul>
      <p>
        Do not send us passwords, staff account credentials, or customer details. We never need
        them, and we do not want them in a mailbox.
      </p>

      <h2>Common questions</h2>

      <h3>Does the test place real orders?</h3>
      <p>
        No. Every run stops as soon as the payment step is visible. Nothing is typed into a
        checkout field and no pay or complete-order control is ever clicked. This is enforced by
        tests in our build. See <a href={new URL("/bot", appUrl).toString()}>about our bot</a>.
      </p>

      <h3>Will this show up in my analytics?</h3>
      <p>
        The runs are real browser visits, so they can appear as sessions and add-to-cart events.
        They cannot create a contactable abandoned cart or trigger a recovery email, because no
        contact field is ever filled in. The{" "}
        <a href={new URL("/bot", appUrl).toString()}>bot page</a> lists the user agent and egress
        addresses to exclude.
      </p>

      <h3>My product went out of stock and I got an alert. Is that a bug?</h3>
      <p>
        A sold-out product is reported as a product problem, not a checkout outage, and it does not
        count toward the failure streak that opens an incident. If you received an outage page for
        a sold-out product, that is a defect &mdash; report it. Point the monitor at a product you
        keep in stock, or enable auto-pause in settings.
      </p>

      <h3>Why did I get an alert when my store was fine?</h3>
      <p>
        Two things commonly cause this. A bot-management or WAF rule blocking our traffic is
        reported as a setup problem rather than an outage &mdash; allowlist the user agent on the
        bot page. Separately, if a bot challenge appears mid-checkout, the run records that
        specifically rather than claiming your store is down. Send us the incident link either way.
      </p>

      <h3>How do I stop the traffic immediately?</h3>
      <p>
        Disable the monitor from inside the app, or uninstall CheckoutWatch. Uninstalling stops
        everything at once: monitors are disabled, queued runs are cancelled, and our stored access
        token is deleted.
      </p>

      <h3>How do I change or cancel my plan?</h3>
      <p>
        From the Billing page inside the app. Billing runs through Shopify and appears on your
        regular Shopify invoice, so cancelling the subscription there ends the charge. Downgrading
        disables any monitors above the new plan&rsquo;s limit rather than deleting them.
      </p>

      <h3>Something is wrong with my data, or I want it deleted.</h3>
      <p>
        Uninstalling deletes the access token immediately and triggers Shopify&rsquo;s data-deletion
        webhooks, which purge the store&rsquo;s rows. For anything else, including a data export,
        see the <a href={new URL("/legal/privacy", appUrl).toString()}>privacy policy</a> or email
        us.
      </p>

      <h2>Reporting a security issue</h2>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with &ldquo;security&rdquo; in
        the subject. Please give us a reasonable window to fix an issue before disclosing it
        publicly. Do not run automated scans or load tests against our infrastructure &mdash; we ask
        merchants not to do to us what we take care not to do to them.
      </p>

      <footer>
        <p className="meta">
          <a href={new URL("/home", appUrl).toString()}>Overview</a> ·{" "}
          <a href={new URL("/legal/privacy", appUrl).toString()}>Privacy</a> ·{" "}
          <a href={new URL("/legal/terms", appUrl).toString()}>Terms</a> ·{" "}
          <a href={new URL("/bot", appUrl).toString()}>About our bot</a>
        </p>
      </footer>
    </main>
  );
}
