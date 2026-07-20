import { ApiVersion, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "@checkoutwatch/db";
import { getConfig } from "@checkoutwatch/core/server";

let configured: ReturnType<typeof shopifyApp> | undefined;

export function getShopifyApp(): ReturnType<typeof shopifyApp> {
  if (configured) return configured;
  const config = getConfig();
  if (config.shopifyAuth !== "real" || !config.shopifyApiKey || !config.shopifyApiSecret) {
    throw new Error("Real Shopify authentication is not configured");
  }
  configured = shopifyApp({
    apiKey: config.shopifyApiKey,
    apiSecretKey: config.shopifyApiSecret,
    appUrl: config.shopifyAppUrl,
    apiVersion: ApiVersion.July26,
    scopes: [...config.shopifyScopes],
    sessionStorage: new PrismaSessionStorage(prisma),
  });
  return configured;
}
