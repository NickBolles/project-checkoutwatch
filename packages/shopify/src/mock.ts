import type { MainTheme, ShopifyAdmin, ShopifyProduct, ShopifyShop } from "./types.js";

const DEFAULT_THEME_UPDATED_AT = "2026-07-20T00:00:00.000Z";

export class MockShopifyAdmin implements ShopifyAdmin {
  private readonly themes = new Map<string, MainTheme>();

  constructor(private readonly fixtureStorefrontUrl = "http://localhost:4600") {}

  listProducts(_shopDomain: string): Promise<ShopifyProduct[]> {
    return Promise.resolve([
      {
        id: "gid://shopify/Product/1",
        handle: "test-product",
        title: "Fixture product",
        variants: [{ id: "1001", title: "Default", available: true }],
      },
    ]);
  }

  getShop(shopDomain: string): Promise<ShopifyShop> {
    return Promise.resolve({
      domain: shopDomain,
      name: `Fixture shop (${new URL(this.fixtureStorefrontUrl).host})`,
    });
  }

  getMainTheme(shopDomain: string): Promise<MainTheme> {
    return Promise.resolve(
      this.themes.get(shopDomain) ?? {
        id: "gid://shopify/Theme/1",
        name: "Fixture main",
        updatedAt: DEFAULT_THEME_UPDATED_AT,
      },
    );
  }

  setMainTheme(shopDomain: string, theme: MainTheme): void {
    this.themes.set(shopDomain, { ...theme });
  }
}
