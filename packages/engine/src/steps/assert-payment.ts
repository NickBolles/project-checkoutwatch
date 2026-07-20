import type { Page } from "playwright";
import { CheckoutAssertionError } from "../errors.js";

export async function assertPaymentStep(page: Page, knownPaymentOrigins: readonly string[]): Promise<void> {
  const contact = page.locator('input[type="email"], input[name*="email"]');
  if ((await contact.count()) === 0 || !(await contact.first().isVisible())) throw new CheckoutAssertionError("CONTACT_INPUT_MISSING", "Checkout contact input is missing", "assert_payment_step");
  const cssSelectors = [
    '[aria-label*="payment" i]', '[data-testid*="payment" i]',
    ...knownPaymentOrigins.map((origin) => `iframe[src^="${origin}"]`),
  ];
  const hasCssIndicator = (await Promise.all(cssSelectors.map((selector) => page.locator(selector).count()))).some((count) => count > 0);
  const hasTextIndicator = (await page.getByText(/payment method|credit card|pay now/i).count()) > 0;
  if (!hasCssIndicator && !hasTextIndicator) throw new CheckoutAssertionError("PAYMENT_IFRAME_MISSING", "No payment-step indicator rendered", "assert_payment_step");
}
