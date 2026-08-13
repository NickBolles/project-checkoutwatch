import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { PLANS } from "@checkoutwatch/core";
import { getConfig } from "@checkoutwatch/core/server";
import { publicPageStyles } from "./public-page.css.js";
import { SUPPORT_EMAIL } from "./public-contact.js";

export const meta: MetaFunction = () => [
  { title: "CheckoutWatch — know your Shopify checkout works, before your customers do" },
  { name: "robots", content: "index,follow" },
  {
    name: "description",
    content:
      "CheckoutWatch walks your real Shopify checkout in a real browser every few minutes and alerts you when it breaks. Status pages tell you the platform is up; this tells you your store can take an order.",
  },
];

/**
 * The public marketing page. It cannot live at "/" -- routes.ts mounts the
 * embedded admin app there, and that route authenticates against Shopify -- so
 * the listing's app-website field points here instead.
 *
 * Plan rows are derived from PLANS rather than restated, so published pricing
 * cannot drift from what billing actually charges.
 */
export function loader() {
  return {
    appUrl: getConfig().shopifyAppUrl,
    plans: Object.values(PLANS).map((plan) => ({
      label: plan.label,
      priceMonthlyUsd: plan.priceMonthlyUsd,
      maxMonitors: plan.entitlements.maxMonitors,
      minIntervalMinutes: plan.entitlements.minIntervalMinutes,
      channels: plan.entitlements.channels.join(", "),
      aiDiagnosis: plan.entitlements.aiDiagnosis,
      publicStatusPage: plan.entitlements.publicStatusPage,
      trialDays: plan.trialDays,
    })),
  };
}

export interface HomeData {
  appUrl: string;
  plans: {
    label: string;
    priceMonthlyUsd: number;
    maxMonitors: number;
    minIntervalMinutes: number;
    channels: string;
    aiDiagnosis: boolean;
    publicStatusPage: boolean;
    trialDays: number;
  }[];
}

export default function HomeRoute() {
  return <HomePage data={useLoaderData<typeof loader>()} />;
}

export function HomePage({ data }: { data: HomeData }) {
  const { appUrl, plans } = data;
  const trialDays = plans.find((plan) => plan.trialDays > 0)?.trialDays ?? 14;

  return (
    <main className="cw-public">
      <style>{publicPageStyles}</style>
      <p className="brand">CHECKOUTWATCH</p>
      <h1>Know your checkout works, before your customers tell you it doesn&rsquo;t.</h1>
      <p className="lede">
        CheckoutWatch opens a real browser, walks your real storefront to the payment step, and
        alerts you the moment it stops working. Not a ping. Not a status page. The actual path a
        customer takes to give you money.
      </p>

      <div className="callout">
        <strong>A broken checkout is silent.</strong> Orders simply stop. Nothing errors on your
        dashboard, no customer emails you, and the platform status page stays green &mdash; because
        Shopify is fine. It is your theme, your app, or your payment configuration that broke.
        Merchants routinely find out hours later, from a drop in the sales graph.
      </div>

      <h2>What it actually does</h2>
      <p>
        Every run is the same four steps a shopper takes, performed in a headless Chromium browser
        against your live storefront:
      </p>
      <ol>
        <li>Open a product page you chose.</li>
        <li>Add it to the cart.</li>
        <li>Proceed to checkout.</li>
        <li>Confirm the payment step rendered &mdash; then stop.</li>
      </ol>
      <p>
        The run stops as soon as payment is on screen. It never enters an email address, shipping
        address, phone number, or card details, and it never completes an order. See{" "}
        <a href={new URL("/bot", appUrl).toString()}>about our bot</a> for how to identify and
        allowlist the traffic.
      </p>

      <h2>Why not just a status page or an uptime ping</h2>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Catches a broken checkout?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Shopify platform status</td>
            <td>No &mdash; it is green during your outage, because the platform is up</td>
          </tr>
          <tr>
            <td>HTTP uptime ping on your homepage</td>
            <td>No &mdash; the homepage returns 200 while the cart is broken</td>
          </tr>
          <tr>
            <td>Walking the real checkout in a real browser</td>
            <td>Yes &mdash; this is the only check that exercises the thing you sell through</td>
          </tr>
        </tbody>
      </table>

      <h2>Features</h2>
      <ul>
        <li>
          <strong>Real-browser checkout monitoring.</strong> Chromium, your live storefront, timed
          per step so you can see which step slowed down or failed.
        </li>
        <li>
          <strong>Alerts that mean something.</strong> A failure must repeat before it pages you.
          One transient blip does not wake you at 3am, and a sold-out product is reported as a
          product problem rather than an outage.
        </li>
        <li>
          <strong>Failure diagnosis.</strong> Every incident arrives with the failing step, its
          timings, a screenshot, and &mdash; on paid plans &mdash; an AI reading of the likely
          cause, including whether a recent theme change lines up with the failure.
        </li>
        <li>
          <strong>Theme-change correlation.</strong> The app watches your published theme, so
          &ldquo;checkout broke twenty minutes after a theme publish&rdquo; is something the incident
          tells you rather than something you work out later.
        </li>
        <li>
          <strong>Multi-channel delivery.</strong> Email on every plan; Slack and Discord from
          Growth; SMS on Pro.
        </li>
        <li>
          <strong>Public status page.</strong> On Pro, publish a sanitized uptime page for your own
          customers and support team.
        </li>
      </ul>

      <h2>Plans</h2>
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Price</th>
            <th>Monitors</th>
            <th>Fastest interval</th>
            <th>Channels</th>
            <th>AI diagnosis</th>
            <th>Status page</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.label}>
              <td>{plan.label}</td>
              <td>{plan.priceMonthlyUsd === 0 ? "Free" : `$${plan.priceMonthlyUsd}/mo`}</td>
              <td>{plan.maxMonitors}</td>
              <td>{plan.minIntervalMinutes} min</td>
              <td>{plan.channels}</td>
              <td>{plan.aiDiagnosis ? "Yes" : "—"}</td>
              <td>{plan.publicStatusPage ? "Yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Paid plans include a {trialDays}-day free trial. Billing is handled by Shopify and appears
        on your regular Shopify invoice; you can change or cancel your plan at any time from inside
        the app.
      </p>

      <h2>What it asks for</h2>
      <p>
        CheckoutWatch requests two read-only scopes and nothing else: <code>read_products</code>, to
        list products so you can pick one to monitor, and <code>read_themes</code>, to notice when
        your published theme changes. It cannot read your orders, your customers, or your payment
        records, because it never asks for the access that would allow it.
      </p>

      <h2>Install</h2>
      <p>
        CheckoutWatch installs from the Shopify App Store and runs inside your Shopify admin. Pick a
        product, pick an interval, and the first check runs immediately.
      </p>

      <footer>
        <p className="meta">
          <a href={new URL("/support", appUrl).toString()}>Support</a> ·{" "}
          <a href={new URL("/legal/privacy", appUrl).toString()}>Privacy</a> ·{" "}
          <a href={new URL("/legal/terms", appUrl).toString()}>Terms</a> ·{" "}
          <a href={new URL("/bot", appUrl).toString()}>About our bot</a>
        </p>
        <p className="meta">
          Questions before installing? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </footer>
    </main>
  );
}
