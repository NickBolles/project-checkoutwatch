import { getWebRuntime } from "../services/runtime.server.js";
import { purgeShop, verifiedShopifyPayload } from "../services/webhooks.server.js";

export async function action({ request }: { request: Request }) {
  const payload = await verifiedShopifyPayload<{ shop_domain?: string }>(request, "shop/redact");
  if (!payload.shop_domain) throw new Response("Missing shop domain", { status: 400 });
  await purgeShop(await getWebRuntime(), payload.shop_domain);
  return new Response(null, { status: 204 });
}
