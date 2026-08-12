import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import { WebAppService } from "../app/services/web-app.server.js";
import { isolatedClient } from "./helpers.js";

const clients: Array<Awaited<ReturnType<typeof isolatedClient>>["client"]> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  vi.resetModules();
});

class RecordingQueue implements JobQueue {
  jobs: Array<{ name: string; payload: unknown; options?: EnqueueOpts }> = [];
  add<T>(name: string, payload: T, options?: EnqueueOpts) {
    this.jobs.push({ name, payload, ...(options ? { options } : {}) });
    return Promise.resolve(options?.jobId ?? String(this.jobs.length));
  }
  process<T>(_name: string, _handler: JobHandler<T>): Promise<ProcessorHandle> {
    return Promise.resolve({ close: () => Promise.resolve() });
  }
  cancelWhere(): Promise<number> {
    return Promise.resolve(0);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function seedMonitor(shopDomain: string, lastRunAt?: Date) {
  const { client } = await isolatedClient("checkoutwatch-launch-");
  clients.push(client);
  const shop = await client.shop.create({
    data: { shopDomain, storefrontUrl: "http://localhost:4600", plan: "free" },
  });
  const monitor = await client.monitor.create({
    data: {
      shopId: shop.id,
      name: "checkout",
      productHandle: "test-product",
      productTitle: "Fixture",
      intervalMinutes: 60,
      enabled: true,
      ...(lastRunAt ? { lastRunAt } : {}),
    },
  });
  const queue = new RecordingQueue();
  return { client, shop, monitor, queue, service: new WebAppService(client, queue, []) };
}

describe("manual run frequency floor", () => {
  it("rejects a manual run inside the floor, so a stuck client cannot hammer a live store", async () => {
    const { shop, monitor, queue, service } = await seedMonitor("floor-inside.test", new Date());

    await expect(service.runNow(shop.id, monitor.id)).rejects.toMatchObject({ status: 429 });
    expect(queue.jobs).toHaveLength(0);
  });

  it("allows a manual run once the floor has elapsed", async () => {
    const { shop, monitor, queue, service } = await seedMonitor(
      "floor-elapsed.test",
      new Date(Date.now() - 10 * 60_000),
    );

    await service.runNow(shop.id, monitor.id);
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: "run-check",
        payload: { monitorId: monitor.id, trigger: "manual" },
      }),
    ]);
  });

  it("allows the first manual run when the monitor has never run", async () => {
    const { shop, monitor, queue, service } = await seedMonitor("floor-never-run.test");

    await service.runNow(shop.id, monitor.id);
    expect(queue.jobs).toHaveLength(1);
  });
});

describe("app/scopes_update webhook", () => {
  it("is registered so Shopify can deliver scope changes", async () => {
    const { default: routes } = await import("../app/routes.js");
    expect(JSON.stringify(routes)).toContain("webhooks/app/scopes_update");
  });

  it("rejects an unsigned payload", async () => {
    const { action } = await import("../app/routes/webhooks.app_scopes_update.js");
    const request = new Request("https://checkoutwatch.test/webhooks/app/scopes_update", {
      method: "POST",
      headers: {
        "x-shopify-topic": "app/scopes_update",
        "x-shopify-shop-domain": "scope-test.myshopify.com",
      },
      body: JSON.stringify({ current: ["read_products", "read_themes"] }),
    });
    await expect(action({ request })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a mismatched topic before touching the body", async () => {
    const { action } = await import("../app/routes/webhooks.app_scopes_update.js");
    const request = new Request("https://checkoutwatch.test/webhooks/app/scopes_update", {
      method: "POST",
      headers: {
        "x-shopify-topic": "app/uninstalled",
        "x-shopify-shop-domain": "scope-test.myshopify.com",
      },
      body: "{}",
    });
    await expect(action({ request })).rejects.toMatchObject({ status: 400 });
  });
});
