import { expect, it } from "vitest";
import { SHOPIFY_PACKAGE } from "../src/index.js";

it("exposes the Shopify package boundary", () => {
  expect(SHOPIFY_PACKAGE).toBe("@checkoutwatch/shopify");
});
