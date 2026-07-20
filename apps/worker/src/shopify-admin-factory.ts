import { decrypt, type AppConfig } from "@checkoutwatch/core/server";
import {
  GraphqlShopifyAdmin,
  MockShopifyAdmin,
  type AdminGraphqlClient,
  type ShopifyAdmin,
} from "@checkoutwatch/shopify";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";

export interface ShopifyAdminShop {
  shopDomain: string;
  accessToken: string | null;
}

export interface ShopifyAdminFactory {
  forShop(shop: ShopifyAdminShop): Pick<ShopifyAdmin, "getMainTheme">;
}

export function createShopifyAdminFactory(
  config: Pick<AppConfig, "shopifyAuth" | "encryptionKey" | "fixtureStorefrontUrl">,
  fetchImpl: typeof fetch = fetch,
): ShopifyAdminFactory {
  if (config.shopifyAuth === "mock") {
    const admin = new MockShopifyAdmin(config.fixtureStorefrontUrl);
    return { forShop: () => admin };
  }

  return {
    forShop(shop) {
      if (!isShopifyDomain(shop.shopDomain)) {
        throw new Error(
          `Refusing Shopify Admin request for invalid shop domain: ${shop.shopDomain}`,
        );
      }
      if (!shop.accessToken) {
        throw new Error(`Shop ${shop.shopDomain} has no offline access token`);
      }
      const accessToken = decrypt(shop.accessToken, config.encryptionKey);
      const endpoint = `https://${shop.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
      const client: AdminGraphqlClient = {
        async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-shopify-access-token": accessToken,
            },
            body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
          });
          if (!response.ok) {
            throw new Error(`Shopify Admin GraphQL request failed with HTTP ${response.status}`);
          }
          const payload = (await response.json()) as {
            data?: T;
            errors?: Array<{ message?: string }>;
          };
          if (payload.errors?.length) {
            throw new Error(
              payload.errors.map((error) => error.message ?? "unknown GraphQL error").join("; "),
            );
          }
          if (!payload.data) throw new Error("Shopify Admin GraphQL response did not contain data");
          return payload.data;
        },
      };
      return new GraphqlShopifyAdmin(client);
    },
  };
}

function isShopifyDomain(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value);
}
