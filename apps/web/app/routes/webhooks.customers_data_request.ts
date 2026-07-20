import { verifiedShopifyPayload } from "../services/webhooks.server.js";

export async function action({ request }: { request: Request }) {
  await verifiedShopifyPayload(request, "customers/data_request");
  return Response.json({ customerDataStored: false, categories: [] });
}
