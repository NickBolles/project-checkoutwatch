import { getWebRuntime } from "../services/runtime.server.js";
import { verifiedShopifyPayload } from "../services/webhooks.server.js";

/**
 * Shopify fires `app/scopes_update` when the app's granted access scopes change.
 * The stored session's `scope` column is what the Shopify library compares against
 * the app's configured scopes to decide whether to re-trigger OAuth, so leaving it
 * stale sends merchants through an authorization loop. Reconciling it here keeps
 * the session and the grant in agreement.
 */
export async function action({ request }: { request: Request }) {
  const payload = await verifiedShopifyPayload<{
    current?: string[] | string;
    previous?: string[] | string;
  }>(request, "app/scopes_update");
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });

  const runtime = await getWebRuntime();
  await runtime.client.session.updateMany({
    where: { shop: shopDomain },
    data: { scope: normalizeScopes(payload.current) },
  });
  return new Response(null, { status: 204 });
}

function normalizeScopes(value: string[] | string | undefined): string | null {
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}
