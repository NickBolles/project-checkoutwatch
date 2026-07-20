import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStorefrontFixture, type StorefrontFixture, type StorefrontMode } from "@checkoutwatch/storefront-fixture";
import { CheckoutRunner, LocalArtifactStore, type CheckoutTestDefinition } from "../src/index.js";

describe("CheckoutRunner @engine", () => {
  let browser: Browser;
  let fixture: StorefrontFixture;
  let artifacts: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    fixture = await startStorefrontFixture();
    artifacts = await mkdtemp(join(tmpdir(), "checkoutwatch-engine-"));
  });

  afterAll(async () => {
    await fixture.close();
    await browser.close();
  });

  function definition(timeoutMs = 1000, withVariant = true): CheckoutTestDefinition {
    return {
      storeUrl: fixture.storefrontUrl,
      productHandle: "test-product",
      ...(withVariant ? { variantId: "1001" } : {}),
      timeoutMs,
    };
  }

  function runner(controlProbeUrl = fixture.controlUrl) {
    return new CheckoutRunner({ browser, artifactStore: new LocalArtifactStore(artifacts), controlProbeUrl, knownPaymentOrigins: [fixture.paymentOrigin] });
  }

  it("passes all four assertion-level steps and captures script origins", async () => {
    fixture.setMode("ok");
    const result = await runner().run(definition());
    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => step.name)).toEqual(["visit_product", "add_to_cart", "go_to_checkout", "assert_payment_step"]);
    expect(result.scriptOrigins).toContain(fixture.paymentOrigin);
    expect(result.robotsTxt?.body).toContain("Disallow: /checkout");
  });

  const failures: { mode: StorefrontMode; code: string; step: string; timeout?: number; withVariant?: boolean; capture?: "console" | "network" }[] = [
    { mode: "add_to_cart_broken", code: "ADD_TO_CART_NOT_FOUND", step: "visit_product", withVariant: false, capture: "console" },
    { mode: "checkout_500", code: "CHECKOUT_HTTP_5XX", step: "go_to_checkout", capture: "network" },
    { mode: "payment_iframe_missing", code: "PAYMENT_IFRAME_MISSING", step: "assert_payment_step", capture: "console" },
    { mode: "slow_checkout", code: "TIMEOUT_STEP_GO_TO_CHECKOUT", step: "go_to_checkout", timeout: 200, capture: "network" },
    { mode: "sold_out", code: "PRODUCT_UNAVAILABLE", step: "visit_product" },
  ];

  for (const testCase of failures) {
    it(`classifies ${testCase.mode} as ${testCase.code}`, async () => {
      fixture.setMode(testCase.mode);
      const result = await runner().run(definition(testCase.timeout ?? 1000, testCase.withVariant ?? true));
      expect(result).toMatchObject({ status: "failed", failureCode: testCase.code, failureStep: testCase.step });
      expect(result.screenshotPath).toBeTruthy();
      await access(result.screenshotPath!);
      if (testCase.capture === "console") expect(result.console.length).toBeGreaterThan(0);
      if (testCase.capture === "network") expect(result.failedRequests.length).toBeGreaterThan(0);
    });
  }

  it("classifies bot challenges as error and never attempts bypass", async () => {
    fixture.setMode("bot_challenge");
    const result = await runner().run(definition());
    expect(result).toMatchObject({ status: "error", failureCode: "BOT_CHALLENGE", failureStep: "visit_product" });
    expect(result.screenshotPath).toBeTruthy();
  });

  for (const mode of ["console_error", "third_party_script_added"] as const) {
    it(`treats ${mode} as observation data, not a failure`, async () => {
      fixture.setMode(mode);
      const result = await runner().run(definition());
      expect(result.status).toBe("passed");
      if (mode === "console_error") expect(result.console).toContainEqual(expect.objectContaining({ type: "error" }));
      if (mode === "third_party_script_added") expect(result.scriptOrigins).toContain(fixture.paymentOrigin);
    });
  }

  it("never navigates past payment or submits checkout fields", async () => {
    fixture.setMode("ok");
    expect((await runner().run(definition())).status).toBe("passed");
    expect(fixture.signals).toEqual({ checkoutCompleteRequests: 0, checkoutFieldPosts: 0 });
  });
});

describe("store reachability taxonomy @engine", () => {
  it("reports STORE_UNREACHABLE when the control probe passes", async () => {
    const fixture = await startStorefrontFixture();
    const browser = await chromium.launch({ headless: true });
    const storeUrl = fixture.storefrontUrl;
    await fixture.stopStorefront();
    try {
      const result = await new CheckoutRunner({ browser, controlProbeUrl: fixture.controlUrl }).run({ storeUrl, productHandle: "test-product", timeoutMs: 500 });
      expect(result).toMatchObject({ status: "failed", failureCode: "STORE_UNREACHABLE" });
    } finally {
      await browser.close();
      await fixture.close();
    }
  });

  it("reports an error when the store and control probe are both down", async () => {
    const fixture = await startStorefrontFixture();
    const browser = await chromium.launch({ headless: true });
    const storeUrl = fixture.storefrontUrl;
    const controlUrl = fixture.controlUrl;
    await Promise.all([fixture.stopStorefront(), fixture.stopControl()]);
    try {
      const result = await new CheckoutRunner({ browser, controlProbeUrl: controlUrl }).run({ storeUrl, productHandle: "test-product", timeoutMs: 500 });
      expect(result).toMatchObject({ status: "error", failureCode: "CONTROL_PROBE_FAILED" });
    } finally {
      await browser.close();
      await fixture.close();
    }
  });
});
