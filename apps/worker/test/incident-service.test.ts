import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@checkoutwatch/db";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import { IncidentService } from "../src/incident-service.js";

const clients: Array<ReturnType<typeof createPrismaClient>> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("IncidentService", () => {
  it("keeps failure streak across errors, never pages the error, and queues alert before AI diagnosis", async () => {
    const client = await isolatedClient();
    const queue = new RecordingQueue();
    const opsFlag = vi.fn();
    const service = new IncidentService(client, queue, { opsFlag });
    const { monitor } = await seedMonitor(client);
    await createRun(
      client,
      monitor.id,
      "f1",
      "2026-07-20T10:00:00Z",
      "failed",
      "CHECKOUT_HTTP_5XX",
    );
    await service.processRunResult("f1");
    expect(queue.jobs.map((job) => job.name)).toEqual(["recheck"]);

    await createRun(client, monitor.id, "e1", "2026-07-20T10:01:00Z", "error", "BROWSER_ERROR");
    await service.processRunResult("e1");
    const afterError = await client.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(afterError.consecutiveFails).toBe(1);
    expect(afterError.consecutiveErrors).toBe(1);
    expect(await client.incident.count()).toBe(0);
    expect(queue.jobs.map((job) => job.name)).toEqual(["recheck"]);

    await createRun(
      client,
      monitor.id,
      "f2",
      "2026-07-20T10:02:00Z",
      "failed",
      "PAYMENT_IFRAME_MISSING",
    );
    await service.processRunResult("f2");
    expect(await client.incident.count({ where: { status: "open" } })).toBe(1);
    expect(queue.jobs.slice(-2).map((job) => job.name)).toEqual([
      "dispatch-alert",
      "diagnose-incident",
    ]);
  });

  it("reopens the same recently resolved incident without another incident-opened alert", async () => {
    const client = await isolatedClient();
    const queue = new RecordingQueue();
    const now = new Date("2026-07-20T12:00:00Z");
    const service = new IncidentService(client, queue, { now: () => now, recheckDelayMs: 1 });
    const { monitor } = await seedMonitor(client);
    await createRun(
      client,
      monitor.id,
      "f1",
      "2026-07-20T11:40:00Z",
      "failed",
      "CHECKOUT_HTTP_5XX",
    );
    await service.processRunResult("f1");
    await createRun(
      client,
      monitor.id,
      "f2",
      "2026-07-20T11:41:00Z",
      "failed",
      "CHECKOUT_HTTP_5XX",
    );
    await service.processRunResult("f2");
    const incident = await client.incident.findFirstOrThrow();
    await createRun(client, monitor.id, "p1", "2026-07-20T11:42:00Z", "passed");
    await service.processRunResult("p1");
    await createRun(
      client,
      monitor.id,
      "f3",
      "2026-07-20T11:43:00Z",
      "failed",
      "CHECKOUT_HTTP_5XX",
    );
    await service.processRunResult("f3");
    await createRun(
      client,
      monitor.id,
      "f4",
      "2026-07-20T11:44:00Z",
      "failed",
      "CHECKOUT_HTTP_5XX",
    );
    await service.processRunResult("f4");
    const reopened = await client.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(reopened.status).toBe("open");
    expect(reopened.reopenCount).toBe(1);
    expect(await client.incident.count()).toBe(1);
    expect(
      queue.jobs.filter(
        (job) =>
          job.name === "dispatch-alert" &&
          (job.payload as { event?: string }).event === "incident_opened",
      ),
    ).toHaveLength(1);
  });
});

class RecordingQueue implements JobQueue {
  jobs: Array<{ name: string; payload: unknown; options?: EnqueueOpts }> = [];
  add<T>(name: string, payload: T, options?: EnqueueOpts): Promise<string> {
    this.jobs.push({ name, payload, ...(options ? { options } : {}) });
    return Promise.resolve(options?.jobId ?? `${this.jobs.length}`);
  }
  process<T>(_name: string, _handler: JobHandler<T>): Promise<ProcessorHandle> {
    return Promise.resolve({ close: () => Promise.resolve() });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function isolatedClient() {
  const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-incident-service-"));
  const databasePath = join(directory, "test.db");
  await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
  const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
  clients.push(client);
  return client;
}

async function seedMonitor(client: ReturnType<typeof createPrismaClient>) {
  await client.monitor.updateMany({ data: { enabled: false } });
  const shop = await client.shop.create({
    data: {
      shopDomain: `incident-${Date.now()}-${Math.random()}.test`,
      storefrontUrl: "https://shop.example.test",
      plan: "growth",
    },
  });
  const monitor = await client.monitor.create({
    data: { shopId: shop.id, name: "Checkout", productHandle: "product", productTitle: "Product" },
  });
  return { shop, monitor };
}

async function createRun(
  client: ReturnType<typeof createPrismaClient>,
  monitorId: string,
  id: string,
  startedAt: string,
  status: "passed" | "failed" | "error",
  failureCode?: string,
) {
  await client.checkRun.create({
    data: {
      id,
      monitorId,
      status,
      startedAt: new Date(startedAt),
      finishedAt: new Date(new Date(startedAt).getTime() + 1000),
      ...(failureCode ? { failureCode } : {}),
    },
  });
}
