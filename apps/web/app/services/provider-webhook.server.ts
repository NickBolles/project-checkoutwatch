import { ingestStatusWebhook, type ChannelType } from "@checkoutwatch/alerts";
import { PrismaDeliveryLogStore } from "@checkoutwatch/db";
import { getWebRuntime } from "./runtime.server.js";

export async function providerWebhook(request: Request, type: ChannelType) {
  const runtime = await getWebRuntime();
  const adapter = runtime.adapters.find((candidate) => candidate.type === type);
  if (!adapter) return new Response("Provider is not configured", { status: 503 });
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  const store = new PrismaDeliveryLogStore(runtime.client, "provider-webhook");
  const result = await ingestStatusWebhook(adapter, store, headers, body);
  return Response.json(result, {
    status: result.accepted ? 200 : result.reason === "invalid_signature" ? 401 : 400,
  });
}
