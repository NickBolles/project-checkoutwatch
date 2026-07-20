import { verifiedShopifyPayload } from "../services/webhooks.server.js";

export async function action({ request }: { request: Request }) {
  await verifiedShopifyPayload(request, "customers/redact");
  return new Response(null, { status: 204 });
}
