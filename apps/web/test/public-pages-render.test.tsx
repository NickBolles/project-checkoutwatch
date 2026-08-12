import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotInfoPage, loader as botLoader } from "../app/routes/bot.js";
import { PrivacyPolicyPage, loader as privacyLoader } from "../app/routes/legal.privacy.js";

/**
 * /bot and /legal/privacy are unauthenticated pages that live outside the Shopify
 * admin iframe -- no Polaris, no App Bridge. Both are load-bearing for launch: the
 * synthetic-traffic user agent points at /bot, and /legal/privacy is the privacy
 * policy URL on the App Store listing. A render failure on either would only
 * surface to a merchant or an App Store reviewer, so pin them here.
 */
describe("bot information page", () => {
  it("publishes a user agent whose +url points at this deployment", () => {
    const data = botLoader();
    expect(data.userAgent).toBe("CheckoutWatchBot/1.0 (+http://localhost:3000/bot)");
    // Regression guard: the UA used to hardcode the dead checkoutwatch.app domain.
    expect(data.userAgent).not.toContain("checkoutwatch.app");
  });

  it("renders the identification, allowlisting, and stop-the-traffic sections", () => {
    const html = renderToStaticMarkup(
      <BotInfoPage
        data={{
          userAgent: "CheckoutWatchBot/1.0 (+https://example.test/bot)",
          egressIpv4: "203.0.113.10",
          egressIpv6: null,
          appUrl: "https://example.test",
        }}
      />,
    );

    expect(html).toContain("CheckoutWatchBot/1.0 (+https://example.test/bot)");
    expect(html).toContain("203.0.113.10");
    expect(html).toContain("never completes a purchase");
    expect(html).toContain("Allowlisting");
    expect(html).toContain("Stopping the tests");
    expect(html).toContain("https://example.test/legal/privacy");
  });

  it("degrades gracefully when no egress addresses are configured", () => {
    const html = renderToStaticMarkup(
      <BotInfoPage
        data={{
          userAgent: "CheckoutWatchBot/1.0 (+https://example.test/bot)",
          egressIpv4: null,
          egressIpv6: null,
          appUrl: "https://example.test",
        }}
      />,
    );

    expect(html).toContain("available on request");
    expect(html).not.toContain("Requests originate from these addresses");
  });
});

describe("privacy policy page", () => {
  it("states the scopes the app actually requests and the no-customer-PII position", () => {
    const html = renderToStaticMarkup(<PrivacyPolicyPage data={privacyLoader()} />);

    expect(html).toContain("Privacy Policy");
    expect(html).toContain("read_products");
    expect(html).toContain("read_themes");
    expect(html).toContain("do not collect your customers");
    // Every sub-processor named in the policy must be one the app really uses.
    for (const processor of ["Resend", "Twilio", "Anthropic", "Slack"]) {
      expect(html).toContain(processor);
    }
  });
});
