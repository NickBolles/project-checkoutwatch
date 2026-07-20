import { afterEach, describe, expect, it } from "vitest";
import { MockAdapter } from "@checkoutwatch/alerts";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import { aggregateUptime, WebAppService } from "../app/services/web-app.server.js";
import { isolatedClient } from "./helpers.js";

const clients: Array<Awaited<ReturnType<typeof isolatedClient>>["client"]> = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.$disconnect())));

describe("Phase 6 web services", () => {
  it("excludes error and skipped runs from uptime", () => {
    expect(
      aggregateUptime([
        { status: "passed" },
        { status: "failed" },
        { status: "error" },
        { status: "skipped" },
      ]),
    ).toEqual({ uptime: 50, passed: 1, failed: 1, excluded: 2 });
  });

  it("enforces monitor count and interval on create, then queues a real first run", async () => {
    const { client } = await isolatedClient();
    clients.push(client);
    const shop = await client.shop.create({
      data: {
        shopDomain: "phase6-create.test",
        storefrontUrl: "http://localhost:4600",
        plan: "free",
      },
    });
    const queue = new RecordingQueue();
    const service = new WebAppService(client, queue, []);
    const monitor = await service.createMonitor({
      shopId: shop.id,
      plan: "free",
      product: { handle: "test-product", title: "Fixture", variantId: "1001" },
      requestedInterval: 5,
    });
    expect(monitor.intervalMinutes).toBe(60);
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: "run-check",
        payload: { monitorId: monitor.id, trigger: "manual" },
      }),
    ]);
    await expect(
      service.createMonitor({
        shopId: shop.id,
        plan: "free",
        product: { handle: "other", title: "Other" },
        requestedInterval: 60,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("sends test alerts through the dispatcher and persists proof rows", async () => {
    const { client, directory } = await isolatedClient();
    clients.push(client);
    const shop = await client.shop.create({
      data: {
        shopDomain: "phase6-alert.test",
        storefrontUrl: "http://localhost:4600",
        plan: "free",
        channels: { create: { type: "email", destination: "mock://owner@example.test" } },
      },
    });
    const service = new WebAppService(client, new RecordingQueue(), [
      new MockAdapter("email", directory),
    ]);
    await service.testAlerts(shop.id, "free");
    expect(await client.alertDelivery.findMany({ where: { shopId: shop.id } })).toEqual([
      expect.objectContaining({ event: "test", status: "delivered", channelType: "email" }),
    ]);
  });
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
