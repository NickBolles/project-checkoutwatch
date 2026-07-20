import type { Diagnosis, Diagnoser, FailureContext } from "./types.js";

interface Rule {
  summary: string;
  probableCause: string;
  confidence: Diagnosis["confidence"];
}

const rules: Record<string, Rule> = {
  PRODUCT_HTTP_ERROR: {
    summary: "The monitored product page returned an HTTP error.",
    probableCause:
      "The product URL was removed, redirected incorrectly, or is temporarily unavailable.",
    confidence: "high",
  },
  ADD_TO_CART_NOT_FOUND: {
    summary: "CheckoutWatch could not find a usable add-to-cart control.",
    probableCause: "A product template or theme change removed or renamed the add-to-cart form.",
    confidence: "high",
  },
  ADD_TO_CART_FAILED: {
    summary: "The storefront rejected the add-to-cart request.",
    probableCause:
      "Product-form JavaScript, inventory rules, or a storefront app prevented the cart update.",
    confidence: "medium",
  },
  CART_EMPTY: {
    summary: "The cart remained empty after the product was added.",
    probableCause: "Cart JavaScript or an app integration discarded the cart update.",
    confidence: "high",
  },
  CHECKOUT_HTTP_5XX: {
    summary: "The checkout endpoint returned a server error.",
    probableCause: "Shopify checkout or a checkout-integrated app failed while rendering the page.",
    confidence: "high",
  },
  CHECKOUT_NOT_REACHED: {
    summary: "The storefront did not reach a recognizable checkout page.",
    probableCause: "A redirect, theme customization, or checkout app interrupted navigation.",
    confidence: "medium",
  },
  PAYMENT_IFRAME_MISSING: {
    summary: "The checkout loaded without a visible payment step.",
    probableCause: "The payment provider iframe or payment-section integration failed to load.",
    confidence: "high",
  },
  CONTACT_INPUT_MISSING: {
    summary: "The checkout loaded without its contact-information input.",
    probableCause:
      "Checkout rendering stopped before the customer-information section became available.",
    confidence: "high",
  },
  PRODUCT_UNAVAILABLE: {
    summary: "The monitored product or variant is unavailable.",
    probableCause:
      "The product was deleted, unpublished, or sold out; the checkout itself may still be healthy.",
    confidence: "high",
  },
  BOT_CHALLENGE: {
    summary: "The storefront presented an automated-traffic challenge.",
    probableCause: "A bot-protection rule is blocking CheckoutWatch and may require allowlisting.",
    confidence: "high",
  },
  STORE_UNREACHABLE: {
    summary:
      "The merchant storefront could not be reached while the control probe remained healthy.",
    probableCause: "The store origin has a DNS, TLS, network, or hosting outage.",
    confidence: "high",
  },
  CONTROL_PROBE_FAILED: {
    summary: "CheckoutWatch could not verify the storefront because its control probe also failed.",
    probableCause: "The worker network or monitoring infrastructure is unavailable.",
    confidence: "high",
  },
  BROWSER_ERROR: {
    summary: "The checkout run ended because the browser engine failed.",
    probableCause: "The monitoring browser crashed or encountered an internal runner error.",
    confidence: "medium",
  },
};

export class HeuristicDiagnoser implements Diagnoser {
  diagnose(context: FailureContext): Promise<Diagnosis> {
    const rule = context.failureCode.startsWith("TIMEOUT_STEP_")
      ? {
          summary: `The ${humanize(context.failureStep ?? "checkout")} step timed out.`,
          probableCause:
            "The storefront or a required third-party resource did not respond within the step budget.",
          confidence: "medium" as const,
        }
      : (rules[context.failureCode] ?? {
          summary: "The checkout run failed its verification.",
          probableCause:
            "The captured evidence did not match a more specific known failure pattern.",
          confidence: "low" as const,
        });
    const evidence = buildEvidence(context);
    let probableCause = rule.probableCause;
    const paymentFailure =
      context.failureCode === "PAYMENT_IFRAME_MISSING" &&
      context.failedRequests.some((request) => /payment|stripe|card|checkout/i.test(request.url));
    if (paymentFailure)
      probableCause =
        "The payment provider's iframe failed to load; a captured payment-related request also failed.";
    const addedScript = newestAddedScript(context);
    if (addedScript) probableCause += ` This began after script ${addedScript} appeared.`;
    return Promise.resolve({
      summary: rule.summary,
      probableCause,
      evidence,
      confidence: rule.confidence,
      provider: "heuristic",
    });
  }
}

function buildEvidence(context: FailureContext): string[] {
  const evidence = [
    `Failure code: ${context.failureCode}${context.failureStep ? ` at ${context.failureStep}` : ""}.`,
  ];
  const request = context.failedRequests[0];
  if (request)
    evidence.push(
      `Failed request: ${request.method} ${request.url}${request.status ? ` (${request.status})` : ""}.`,
    );
  const consoleError = context.consoleErrors[0];
  if (consoleError) evidence.push(`Console: ${consoleError.text}`);
  const addedScript = newestAddedScript(context);
  if (addedScript) evidence.push(`A new script origin appeared recently: ${addedScript}.`);
  return evidence;
}

function newestAddedScript(context: FailureContext): string | undefined {
  return (
    context.scriptOriginDiff.added[0] ??
    (context.recentChanges.find(
      (event) => event.kind === "script_added" && typeof event.detail.origin === "string",
    )?.detail.origin as string | undefined)
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
