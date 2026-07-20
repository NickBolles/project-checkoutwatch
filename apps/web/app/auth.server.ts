import type { BillingAdapter, ShopifyAdmin } from "@checkoutwatch/shopify";
import {
  GraphqlBillingAdapter,
  GraphqlShopifyAdmin,
  MockBillingAdapter,
  MockShopifyAdmin,
} from "@checkoutwatch/shopify";
import { getWebRuntime } from "./services/runtime.server.js";
import { PrismaBillingStore } from "./services/billing-store.server.js";
import { getShopifyApp } from "./shopify.server.js";
import { encrypt } from "@checkoutwatch/core/server";

export interface ShopContext {
  shop: { id: string; domain: string; plan: "free" | "growth" | "pro" };
  admin: ShopifyAdmin;
  billing: BillingAdapter;
}

export async function requireShop(request: Request): Promise<ShopContext> {
  const runtime = await getWebRuntime();
  if (runtime.config.shopifyAuth === "mock") {
    const shop = await runtime.client.shop.upsert({
      where: { shopDomain: "dev-shop.myshopify.com" },
      update: { uninstalledAt: null },
      create: {
        shopDomain: "dev-shop.myshopify.com",
        storefrontUrl: runtime.config.fixtureStorefrontUrl,
        plan: "free",
        channels: {
          create: { type: "email", destination: "mock://merchant@example.test" },
        },
      },
    });
    return {
      shop: { id: shop.id, domain: shop.shopDomain, plan: normalizePlan(shop.plan) },
      admin: new MockShopifyAdmin(shop.storefrontUrl),
      billing: new MockBillingAdapter(new PrismaBillingStore(runtime.client)),
    };
  }

  const authenticated = await getShopifyApp().authenticate.admin(request);
  const stored = await runtime.client.shop.upsert({
    where: { shopDomain: authenticated.session.shop },
    update: { uninstalledAt: null },
    create: {
      shopDomain: authenticated.session.shop,
      storefrontUrl: `https://${authenticated.session.shop}`,
      ...(authenticated.session.accessToken
        ? { accessToken: encrypt(authenticated.session.accessToken, runtime.config.encryptionKey) }
        : {}),
    },
  });
  const client = {
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const response = await authenticated.admin.graphql(query, variables ? { variables } : {});
      const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (payload.errors?.length)
        throw new Error(payload.errors.map((error) => error.message).join("; "));
      if (!payload.data) throw new Error("Shopify GraphQL response did not contain data");
      return payload.data;
    },
  };
  return {
    shop: { id: stored.id, domain: stored.shopDomain, plan: normalizePlan(stored.plan) },
    admin: new GraphqlShopifyAdmin(client),
    billing: new GraphqlBillingAdapter(client, new PrismaBillingStore(runtime.client)),
  };
}

function normalizePlan(value: string): "free" | "growth" | "pro" {
  return value === "growth" || value === "pro" ? value : "free";
}
