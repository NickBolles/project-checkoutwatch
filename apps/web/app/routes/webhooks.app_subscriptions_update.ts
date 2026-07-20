import { handleSubscriptionUpdate } from "@checkoutwatch/shopify";
import { PrismaBillingStore } from "../services/billing-store.server.js";
import { getWebRuntime } from "../services/runtime.server.js";
import { verifiedShopifyPayload } from "../services/webhooks.server.js";

export async function action({ request }: { request: Request }) {
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const payload = await verifiedShopifyPayload<{
    app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string };
  }>(request, "app_subscriptions/update");
  if (!shopDomain || !payload.app_subscription)
    throw new Response("Invalid subscription webhook", { status: 400 });
  const runtime = await getWebRuntime();
  const shop = await runtime.client.shop.findUniqueOrThrow({ where: { shopDomain } });
  const previousPlan = shop.plan;
  const subscription = payload.app_subscription;
  const plan = await handleSubscriptionUpdate(new PrismaBillingStore(runtime.client), shopDomain, {
    ...(subscription.admin_graphql_api_id ? { id: subscription.admin_graphql_api_id } : {}),
    ...(subscription.name ? { name: subscription.name } : {}),
    ...(subscription.status ? { status: subscription.status } : {}),
  });
  await runtime.queue.add(
    "reconcile-plan",
    { shopId: shop.id, previousPlan },
    { jobId: `subscription-update:${shop.id}:${plan}:${Date.now()}` },
  );
  return new Response(null, { status: 204 });
}
