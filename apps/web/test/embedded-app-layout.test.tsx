import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("embedded Shopify app layout", () => {
  it("keeps the Shopify embedded AppProvider and boundary helpers in the shared app layout", async () => {
    const source = await readFile(new URL("../app/routes/app.tsx", import.meta.url), "utf8");
    expect(source).toContain('from "@shopify/shopify-app-react-router/react"');
    expect(source).toContain("<ShopifyAppProvider embedded apiKey={data.apiKey}>");
    expect(source).toContain("await getShopifyApp().authenticate.admin(request)");
    expect(source).toContain("boundary.error(useRouteError())");
    expect(source).toContain("boundary.headers(headersArgs)");
  });
});
