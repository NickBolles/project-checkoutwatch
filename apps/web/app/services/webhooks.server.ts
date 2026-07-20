import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, type AppConfig } from "@checkoutwatch/core/server";
import type { WebRuntime } from "./runtime.server.js";

export async function verifiedShopifyPayload<T>(
  request: Request,
  expectedTopic: string,
  config: AppConfig = getConfig(),
): Promise<T> {
  const rawBody = await request.text();
  const topic = request.headers.get("x-shopify-topic")?.toLowerCase();
  if (topic !== expectedTopic.toLowerCase())
    throw new Response("Unexpected webhook topic", { status: 400 });
  const received = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const secret = webhookSecret(config);
  if (!secret || !validHmac(rawBody, received, secret))
    throw new Response("Invalid webhook signature", { status: 401 });
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Response("Invalid JSON payload", { status: 400 });
  }
}

function webhookSecret(config: AppConfig): string | undefined {
  if (config.shopifyAuth === "real") return config.shopifyApiSecret;
  if (config.nodeEnv === "production") return undefined;
  return config.shopifyMockWebhookSecret ?? "checkoutwatch-local-webhook-secret";
}

export async function uninstallShop(runtime: WebRuntime, shopDomain: string) {
  const shop = await runtime.client.shop.findUnique({
    where: { shopDomain },
    include: { monitors: { select: { id: true } } },
  });
  if (!shop) return { disabled: 0, cancelled: 0 };
  const monitorIds = new Set(shop.monitors.map((monitor) => monitor.id));
  const incidentIds = new Set(
    (
      await runtime.client.incident.findMany({
        where: { monitor: { shopId: shop.id } },
        select: { id: true },
      })
    ).map((incident) => incident.id),
  );
  const disabled = await runtime.client.$transaction(async (transaction) => {
    const result = await transaction.monitor.updateMany({
      where: { shopId: shop.id },
      data: { enabled: false, runningAt: null },
    });
    await transaction.shop.update({
      where: { id: shop.id },
      data: { uninstalledAt: new Date(), accessToken: null },
    });
    await transaction.session.deleteMany({ where: { shop: shopDomain } });
    return result.count;
  });
  const cancelled = await runtime.queue.cancelWhere((_name, payload) => {
    if (typeof payload !== "object" || payload === null) return false;
    const record = payload as Record<string, unknown>;
    return (
      (typeof record.monitorId === "string" && monitorIds.has(record.monitorId)) ||
      (typeof record.incidentId === "string" && incidentIds.has(record.incidentId))
    );
  });
  return { disabled, cancelled };
}

export async function purgeShop(runtime: WebRuntime, shopDomain: string) {
  const shop = await runtime.client.shop.findUnique({
    where: { shopDomain },
    include: { monitors: { select: { id: true } } },
  });
  if (!shop) return;
  const monitorIds = shop.monitors.map((monitor) => monitor.id);
  await runtime.client.$transaction(async (transaction) => {
    await transaction.alertDelivery.deleteMany({ where: { shopId: shop.id } });
    await transaction.alertChannelConfig.deleteMany({ where: { shopId: shop.id } });
    await transaction.storeChangeEvent.deleteMany({ where: { shopId: shop.id } });
    await transaction.statusPage.deleteMany({ where: { shopId: shop.id } });
    await transaction.billingSubscription.deleteMany({ where: { shopId: shop.id } });
    await transaction.incident.deleteMany({ where: { monitorId: { in: monitorIds } } });
    await transaction.checkRun.deleteMany({ where: { monitorId: { in: monitorIds } } });
    await transaction.monitor.deleteMany({ where: { shopId: shop.id } });
    await transaction.session.deleteMany({ where: { shop: shopDomain } });
    await transaction.shop.delete({ where: { id: shop.id } });
  });
}

function validHmac(body: string, received: string, secret: string) {
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
