import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryDriver } from "@checkoutwatch/queue";
import { PrismaMonitorRunRepository } from "@checkoutwatch/db";
import { parseEnv } from "@checkoutwatch/core/server";
import { action as customerDataRequest } from "../app/routes/webhooks.customers_data_request.js";
import { uninstallShop, verifiedShopifyPayload } from "../app/services/webhooks.server.js";
import type { WebRuntime } from "../app/services/runtime.server.js";
import { isolatedClient } from "./helpers.js";

const resources: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(resources.splice(0).map((close) => close())));

describe("Phase 6 Shopify webhooks", () => {
  it("disables traffic, purges the token, and cancels pending jobs on uninstall", async () => {
    const { client } = await isolatedClient();
    const queue = new MemoryDriver();
    resources.push(
      () => client.$disconnect(),
      () => queue.close(),
    );
    await client.monitor.updateMany({ data: { enabled: false } });
    const shop = await client.shop.create({
      data: {
        shopDomain: "uninstall.test",
        storefrontUrl: "https://uninstall.test",
        accessToken: "encrypted-token",
      },
    });
    const monitor = await client.monitor.create({
      data: {
        shopId: shop.id,
        name: "Checkout",
        productHandle: "test",
        productTitle: "Test",
        nextRunAt: new Date(0),
      },
    });
    await queue.add("run-check", { monitorId: monitor.id }, { delayMs: 60_000 });
    const runtime = { client, queue } as unknown as WebRuntime;
    expect(await uninstallShop(runtime, shop.shopDomain)).toEqual({ disabled: 1, cancelled: 1 });
    expect(await client.shop.findUniqueOrThrow({ where: { id: shop.id } })).toMatchObject({
      accessToken: null,
      uninstalledAt: expect.any(Date),
    });
    expect(await client.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).toMatchObject({
      enabled: false,
    });
    expect(await new PrismaMonitorRunRepository(client).dueMonitors(new Date(), 10)).toHaveLength(
      0,
    );
  });

  it("accepts a correctly mock-signed compliance webhook and rejects a bad signature", async () => {
    const body = JSON.stringify({ shop_domain: "dev-shop.myshopify.com", customer: { id: 1 } });
    const request = signedRequest(body, "customers/data_request");
    expect(await (await customerDataRequest({ request })).json()).toEqual({
      customerDataStored: false,
      categories: [],
    });
    await expect(
      customerDataRequest({
        request: new Request("http://local/webhooks", {
          method: "POST",
          body,
          headers: { "x-shopify-topic": "customers/data_request", "x-shopify-hmac-sha256": "bad" },
        }),
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects the committed mock secret when credentials select real Shopify auth", async () => {
    const body = JSON.stringify({ shop_domain: "victim.myshopify.com" });
    const config = parseEnv({
      NODE_ENV: "test",
      SHOPIFY_API_KEY: "real-key",
      SHOPIFY_API_SECRET: "real-secret",
    });

    await expect(
      verifiedShopifyPayload(signedRequest(body, "shop/redact"), "shop/redact", config),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed for mock-mode webhook verification in production", async () => {
    const body = JSON.stringify({ shop_domain: "victim.myshopify.com" });
    const config = parseEnv({
      NODE_ENV: "production",
      SHOPIFY_AUTH: "mock",
      ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      CONTROL_PROBE_URL: "https://probe.example.com/health",
    });

    await expect(
      verifiedShopifyPayload(signedRequest(body, "shop/redact"), "shop/redact", config),
    ).rejects.toMatchObject({ status: 401 });
  });
});

function signedRequest(body: string, topic: string) {
  const hmac = createHmac("sha256", "checkoutwatch-local-webhook-secret")
    .update(body)
    .digest("base64");
  return new Request("http://local/webhooks", {
    method: "POST",
    body,
    headers: { "x-shopify-topic": topic, "x-shopify-hmac-sha256": hmac },
  });
}
