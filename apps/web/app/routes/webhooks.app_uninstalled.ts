import { getWebRuntime } from "../services/runtime.server.js";
import { uninstallShop, verifiedShopifyPayload } from "../services/webhooks.server.js";

export async function action({ request }: { request: Request }) {
  const payload = await verifiedShopifyPayload<{ myshopify_domain?: string; domain?: string }>(
    request,
    "app/uninstalled",
  );
  const shopDomain = payload.myshopify_domain ?? payload.domain;
  if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });
  await uninstallShop(await getWebRuntime(), shopDomain);
  return new Response(null, { status: 204 });
}
