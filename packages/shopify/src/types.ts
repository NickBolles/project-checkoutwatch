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

export interface BillingAdapter {
  getActivePlan(shopDomain: string): Promise<"free" | "growth" | "pro">;
  ensureSubscription(
    shopDomain: string,
    plan: "free" | "growth" | "pro",
    returnUrl: string,
  ): Promise<{ active: boolean; confirmationUrl?: string }>;
}

export interface BillingStore {
  activePlan(shopDomain: string): Promise<"free" | "growth" | "pro">;
  activate(input: {
    shopDomain: string;
    plan: "free" | "growth" | "pro";
    status: string;
    shopifySubscriptionId?: string;
  }): Promise<void>;
}

export interface AdminGraphqlClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}
