import { getShopifyApp } from "../shopify.server.js";

/**
 * Handles Shopify's OAuth handshake, including the configured /auth/callback return URL.
 * `authenticate.admin` owns redirects, HMAC validation, and session persistence.
 */
export async function loader({ request }: { request: Request }) {
  await getShopifyApp().authenticate.admin(request);
  return null;
}
