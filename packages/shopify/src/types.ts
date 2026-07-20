export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  variants: Array<{ id: string; title: string; available: boolean }>;
}

export interface ShopifyShop {
  domain: string;
  name: string;
}

export interface MainTheme {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ShopifyAdmin {
  listProducts(shopDomain: string): Promise<ShopifyProduct[]>;
  getShop(shopDomain: string): Promise<ShopifyShop>;
  getMainTheme(shopDomain: string): Promise<MainTheme>;
}
