import { describe, expect, it } from "vitest";
import { MockShopifyAdmin } from "../src/index.js";

describe("MockShopifyAdmin", () => {
  it("exposes fixture products and a mutable main theme", async () => {
    const admin = new MockShopifyAdmin("http://localhost:4600");
    expect((await admin.listProducts("shop.test"))[0]?.handle).toBe("test-product");
    const updated = { id: "theme-2", name: "New theme", updatedAt: "2026-07-20T12:00:00.000Z" };
    admin.setMainTheme("shop.test", updated);
    expect(await admin.getMainTheme("shop.test")).toEqual(updated);
  });
});
