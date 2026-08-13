import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLANS } from "@checkoutwatch/core";
import { BotInfoPage, loader as botLoader } from "../app/routes/bot.js";
import { HomePage, loader as homeLoader } from "../app/routes/home.js";
import { PrivacyPolicyPage, loader as privacyLoader } from "../app/routes/legal.privacy.js";
import { TermsPage, loader as termsLoader } from "../app/routes/legal.terms.js";
import { SupportPage, loader as supportLoader } from "../app/routes/support.js";

/**
 * The unauthenticated pages live outside the Shopify admin iframe -- no Polaris,
 * no App Bridge. All five are load-bearing for launch: the synthetic-traffic user
 * agent points at /bot, and /legal/privacy, /support, and /home are the privacy,
 * support, and app-website URLs on the App Store listing. A render failure on any
 * of them would only surface to a merchant or an App Store reviewer, so pin them
 * here.
 */
/**
 * Rendering a page component proves nothing if the route is never registered.
 * These paths are quoted in the App Store listing and in the bot user agent, so a
 * missing or renamed entry in routes.ts is a broken public URL.
 */
describe("public route registration", () => {
  it("registers every public path outside the authenticated app layout", async () => {
    const source = await readFile(new URL("../app/routes.ts", import.meta.url), "utf8");

    const expected: [path: string, module: string][] = [
      ["home", "routes/home.tsx"],
      ["support", "routes/support.tsx"],
      ["bot", "routes/bot.tsx"],
      ["legal/privacy", "routes/legal.privacy.tsx"],
      ["legal/terms", "routes/legal.terms.tsx"],
    ];

    for (const [path, module] of expected) {
      expect(source, path).toContain(`route("${path}", "${module}")`);
    }

    // The public pages must sit after the layout(...) block closes. Inside it they
    // would inherit app.tsx's loader and demand a Shopify session.
    const layoutEnd = source.indexOf("]),");
    expect(layoutEnd).toBeGreaterThan(-1);
    for (const [path] of expected) {
      expect(source.indexOf(`route("${path}"`), path).toBeGreaterThan(layoutEnd);
    }
  });
});

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

describe("landing page", () => {
  it("publishes pricing straight from PLANS so the page cannot drift from billing", () => {
    const data = homeLoader();

    expect(data.plans.map((plan) => plan.label)).toEqual(
      Object.values(PLANS).map((plan) => plan.label),
    );

    const html = renderToStaticMarkup(<HomePage data={data} />);
    for (const plan of Object.values(PLANS)) {
      expect(html).toContain(plan.label);
      if (plan.priceMonthlyUsd > 0) expect(html).toContain(`$${plan.priceMonthlyUsd}/mo`);
    }
  });

  it("states the read-only scopes and the never-completes-a-purchase guarantee", () => {
    const html = renderToStaticMarkup(
      <HomePage data={{ ...homeLoader(), appUrl: "https://example.test" }} />,
    );

    expect(html).toContain("read_products");
    expect(html).toContain("read_themes");
    expect(html).toContain("never completes an order");
    // Cross-links are absolute so they survive being quoted in the listing.
    expect(html).toContain("https://example.test/legal/privacy");
    expect(html).toContain("https://example.test/legal/terms");
    expect(html).toContain("https://example.test/support");
  });
});

describe("support page", () => {
  it("gives a reachable contact, a response target, and what to include", () => {
    const html = renderToStaticMarkup(
      <SupportPage data={{ ...supportLoader(), appUrl: "https://example.test" }} />,
    );

    expect(html).toContain("mailto:support@checkoutwatch.app");
    expect(html).toContain("one business day");
    expect(html).toContain("What to include");
    // Reviewers look for a stated way to stop the traffic and delete the data.
    expect(html).toContain("How do I stop the traffic immediately?");
    expect(html).toContain("https://example.test/legal/privacy");
  });
});

describe("terms of service page", () => {
  it("carries the trial length from PLANS rather than restating it", () => {
    const data = termsLoader();

    expect(data.trialDays).toBe(PLANS.growth.trialDays);
    expect(renderToStaticMarkup(<TermsPage data={data} />)).toContain(
      `${PLANS.growth.trialDays}-day free trial`,
    );
  });

  it("disclaims detection, delivery, and diagnosis rather than implying a guarantee", () => {
    const html = renderToStaticMarkup(
      <TermsPage data={{ ...termsLoader(), appUrl: "https://example.test" }} />,
    );

    expect(html).toContain("We do not guarantee detection");
    expect(html).toContain("We do not guarantee delivery");
    expect(html).toContain("We do not guarantee accuracy");
    // The authorization term is what makes the synthetic traffic defensible.
    expect(html).toContain("entitled to authorize that traffic");
    expect(html).toContain("https://example.test/bot");
  });
});
