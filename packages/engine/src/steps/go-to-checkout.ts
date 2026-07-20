import type { Page } from "playwright";
import type { CheckoutTestDefinition } from "../definition.js";
import { isBotChallenge } from "../compliance.js";
import { CheckoutAssertionError } from "../errors.js";

export async function goToCheckout(page: Page, definition: CheckoutTestDefinition): Promise<number | undefined> {
  const response = await page.goto(new URL("/checkout", definition.storeUrl).href, { waitUntil: "domcontentloaded", timeout: definition.timeoutMs });
  if (await isBotChallenge(page)) throw new CheckoutAssertionError("BOT_CHALLENGE", "Checkout presented a bot challenge", "go_to_checkout");
  const status = response?.status();
  if (status && status >= 500) throw new CheckoutAssertionError("CHECKOUT_HTTP_5XX", `Checkout returned HTTP ${status}`, "go_to_checkout");
  if (!response || (status && status >= 400) || !/\/checkouts?\b/.test(new URL(page.url()).pathname)) throw new CheckoutAssertionError("CHECKOUT_NOT_REACHED", "Browser did not reach checkout", "go_to_checkout");
  return status;
}
