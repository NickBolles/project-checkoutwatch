import type { Page } from "playwright";
import type { CheckoutTestDefinition } from "../definition.js";
import { CheckoutAssertionError } from "../errors.js";

export async function addToCart(page: Page, definition: CheckoutTestDefinition): Promise<number | undefined> {
  const form = page.locator('form[action*="/cart/add"]').first();
  let status: number | undefined;
  if ((await form.count()) > 0) {
    const responsePromise = page.waitForResponse((response) => response.url().includes("/cart/add"), { timeout: definition.timeoutMs });
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    const response = await responsePromise;
    status = response.status();
  } else if (definition.variantId) {
    const response = await page.request.post(new URL("/cart/add.js", definition.storeUrl).href, { form: { id: definition.variantId, quantity: "1" }, timeout: definition.timeoutMs });
    status = response.status();
  } else {
    throw new CheckoutAssertionError("ADD_TO_CART_NOT_FOUND", "No add-to-cart strategy was available", "add_to_cart");
  }
  if (status === 422) throw new CheckoutAssertionError("PRODUCT_UNAVAILABLE", "Store rejected unavailable product", "add_to_cart");
  if (status && status >= 400) throw new CheckoutAssertionError("ADD_TO_CART_FAILED", `Add to cart returned HTTP ${status}`, "add_to_cart");
  const cartResponse = await page.request.get(new URL("/cart.js", definition.storeUrl).href);
  const cart: unknown = await cartResponse.json();
  if (!isNonEmptyCart(cart)) throw new CheckoutAssertionError("CART_EMPTY", "Cart remained empty", "add_to_cart");
  return status;
}

function isNonEmptyCart(value: unknown): boolean {
  return typeof value === "object" && value !== null && "item_count" in value && typeof value.item_count === "number" && value.item_count > 0;
}
