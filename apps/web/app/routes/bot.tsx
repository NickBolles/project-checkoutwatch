import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getConfig } from "@checkoutwatch/core/server";
import { checkoutWatchUserAgent } from "@checkoutwatch/engine";
import { publicPageStyles } from "./public-page.css.js";

export const meta: MetaFunction = () => [
  { title: "CheckoutWatchBot — what it is and how to allowlist it" },
  { name: "robots", content: "index,follow" },
  {
    name: "description",
    content:
      "CheckoutWatchBot performs merchant-authorized synthetic checkout tests. Identification, egress addresses, and allowlisting instructions.",
  },
];

/**
 * The page every synthetic request's user agent points at. COMPLIANCE.md commits
 * to publishing stable egress addresses and allowlisting instructions, and
 * merchants (or their WAF vendor) land here when they see the traffic. Egress
 * addresses come from config rather than being hardcoded so they stay accurate if
 * the deployment moves.
 */
export function loader() {
  const config = getConfig();
  const appUrl = config.shopifyAppUrl;
  return {
    userAgent: checkoutWatchUserAgent(new URL("/bot", appUrl).toString()),
    egressIpv4: process.env.PUBLIC_EGRESS_IPV4 ?? null,
    egressIpv6: process.env.PUBLIC_EGRESS_IPV6 ?? null,
    appUrl,
  };
}

export default function BotInfoPage() {
  const { userAgent, egressIpv4, egressIpv6, appUrl } = useLoaderData<typeof loader>();
  return (
    <main className="cw-public">
      <style>{publicPageStyles}</style>
      <p className="brand">CHECKOUTWATCH</p>
      <h1>About CheckoutWatchBot</h1>
      <p className="lede">
        CheckoutWatchBot runs a short, read-only checkout walkthrough on stores whose owner
        installed CheckoutWatch and asked us to monitor them. If you are seeing this traffic on your
        store, it is because someone with admin access turned it on.
      </p>

      <div className="callout">
        <strong>It never completes a purchase.</strong> The test stops as soon as the payment step
        is visible on screen. It does not enter an email address, shipping address, phone number, or
        card details into any field, and it never clicks a pay or complete-order control. That is
        enforced by tests in our build, not just by policy.
      </div>

      <h2>How to identify it</h2>
      <p>Every request carries this user agent:</p>
      <pre>
        <code>{userAgent}</code>
      </pre>
      {egressIpv4 || egressIpv6 ? (
        <>
          <p>Requests originate from these addresses:</p>
          <ul>
            {egressIpv4 ? (
              <li>
                IPv4 <code>{egressIpv4}</code>
              </li>
            ) : null}
            {egressIpv6 ? (
              <li>
                IPv6 <code>{egressIpv6}</code>
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <p className="meta">
          Egress addresses for this deployment are available on request — contact us using the
          details below and we will confirm them in writing.
        </p>
      )}

      <h2>What a test does</h2>
      <ol>
        <li>Opens one product page that the merchant chose.</li>
        <li>Adds that product to a cart.</li>
        <li>Proceeds to checkout.</li>
        <li>Confirms the payment step actually rendered, then stops and closes the browser.</li>
      </ol>
      <p>
        A run takes a few seconds. Frequency is set by the merchant and floored by their plan, so a
        store sees at most a handful of runs per hour.
      </p>

      <h2>Allowlisting</h2>
      <p>
        If a bot-management rule is blocking these tests, CheckoutWatch reports the run as a setup
        problem rather than an outage — we never attempt to bypass a CAPTCHA, challenge, rate limit,
        or access control. To let the tests through, allow the user agent above (and the addresses,
        if listed) in your WAF, bot manager, or CDN rules.
      </p>

      <h2>Excluding it from analytics</h2>
      <p>
        These are real browser visits, so they can appear in analytics as sessions and add-to-cart
        events. Because no checkout field is ever filled in, they cannot create a contactable
        abandoned cart or trigger a recovery email. To keep reporting clean:
      </p>
      <ul>
        <li>
          Google Analytics 4 — bot filtering excludes known-bot traffic; add an IP filter too.
        </li>
        <li>Shopify analytics — exclude the addresses above where your reporting supports it.</li>
        <li>Third-party pixels — exclude by user agent string.</li>
      </ul>

      <h2>Stopping the tests</h2>
      <p>
        Uninstalling CheckoutWatch from the store stops all traffic immediately: the uninstall
        webhook disables every monitor, cancels queued runs, and deletes our stored access token. No
        further requests are made. A merchant can also disable an individual monitor from inside the
        app at any time.
      </p>

      <footer>
        <p className="meta">
          Questions or a request to stop traffic to your store? Email{" "}
          <a href="mailto:support@checkoutwatch.app">support@checkoutwatch.app</a>. See also our{" "}
          <a href={new URL("/legal/privacy", appUrl).toString()}>privacy policy</a>.
        </p>
      </footer>
    </main>
  );
}
