import type { Page } from "playwright";
import type { CheckoutTestDefinition } from "../definition.js";
import { CheckoutAssertionError } from "../errors.js";
import { isBotChallenge } from "../compliance.js";

export async function visitProduct(page: Page, definition: CheckoutTestDefinition): Promise<number | undefined> {
  const response = await page.goto(new URL(`/products/${definition.productHandle}`, definition.storeUrl).href, { waitUntil: "domcontentloaded", timeout: definition.timeoutMs });
  if (await isBotChallenge(page)) throw new CheckoutAssertionError("BOT_CHALLENGE", "Storefront presented a bot challenge", "visit_product");
  const status = response?.status();
  if (!response || status === 404) throw new CheckoutAssertionError("PRODUCT_UNAVAILABLE", "Product page is unavailable", "visit_product");
  if (status && status >= 400) throw new CheckoutAssertionError("PRODUCT_HTTP_ERROR", `Product returned HTTP ${status}`, "visit_product");
  const productResponse = await page.request.get(new URL(`/products/${definition.productHandle}.js`, definition.storeUrl).href);
  if (productResponse.status() === 404) throw new CheckoutAssertionError("PRODUCT_UNAVAILABLE", "Product JSON is unavailable", "visit_product");
  if (productResponse.ok()) {
    const product: unknown = await productResponse.json();
    if (isSoldOut(product, definition.variantId)) throw new CheckoutAssertionError("PRODUCT_UNAVAILABLE", "Configured product variant is sold out", "visit_product");
  }
  const addControl = page.locator('form[action*="/cart/add"], button[name="add"], [data-testid*="add"]');
  if ((await addControl.count()) === 0 && !definition.variantId) throw new CheckoutAssertionError("ADD_TO_CART_NOT_FOUND", "No add-to-cart control or variant fallback was available", "visit_product");
  return status;
}

function isSoldOut(payload: unknown, variantId?: string): boolean {
  if (typeof payload !== "object" || payload === null || !("variants" in payload) || !Array.isArray(payload.variants)) return false;
  const variants = payload.variants as { id?: number | string; available?: boolean }[];
  const chosen = variantId ? variants.find((variant) => String(variant.id) === variantId) : variants[0];
  return chosen?.available === false;
}
