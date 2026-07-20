import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { SlackWebhookAdapter } from "@checkoutwatch/alerts";
import { createPrismaClient, PrismaMonitorRunRepository } from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { MemoryDriver } from "@checkoutwatch/queue";
import { startStorefrontFixture } from "@checkoutwatch/storefront-fixture";
import { startWebhookSink } from "@checkoutwatch/webhook-sink";
import { registerJobs } from "../src/jobs/index.js";
import { MonitorScheduler } from "../src/scheduler.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("offline incident pipeline @e2e", () => {
  it("delivers failure -> debounce -> incident -> diagnosis -> mock email and sink Slack, then resolves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-incident-"));
    const databasePath = join(directory, "test.db");
    const outboxDir = join(directory, "outbox");
    await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
    const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
    cleanups.push(() => client.$disconnect());
    const fixture = await startStorefrontFixture();
    cleanups.push(() => fixture.close());
    const sink = await startWebhookSink();
    cleanups.push(() => sink.close());
    const browser = await chromium.launch({ headless: true });
    cleanups.push(() => browser.close());
    const queue = new MemoryDriver();
    cleanups.push(() => queue.close());

    await client.monitor.updateMany({ data: { enabled: false } });
    const shop = await client.shop.create({
      data: {
        shopDomain: `e2e-${Date.now()}.test`,
        storefrontUrl: fixture.storefrontUrl,
        plan: "growth",
      },
    });
    await client.alertChannelConfig.createMany({
      data: [
        { shopId: shop.id, type: "email", destination: "mock://merchant@example.test" },
        { shopId: shop.id, type: "slack", destination: `${sink.url}/slack` },
      ],
    });
    const monitor = await client.monitor.create({
      data: {
        shopId: shop.id,
        name: "Main checkout",
        productHandle: "test-product",
        productTitle: "Fixture product",
        variantId: "1001",
        nextRunAt: new Date(0),
      },
    });
    const repository = new PrismaMonitorRunRepository(client);
    const runner = new CheckoutRunner({
      browser,
      artifactStore: new LocalArtifactStore(join(directory, "artifacts")),
      controlProbeUrl: fixture.controlUrl,
      knownPaymentOrigins: [fixture.paymentOrigin],
    });
    let diagnosisStarted = false;
    const handles = await registerJobs(queue, repository, runner, 1, {
      client,
      adapters: [new SlackWebhookAdapter()],
      mockOutboxDir: outboxDir,
      incident: { recheckDelayMs: 5 },
      diagnosis: {
        provider: "anthropic",
        client: {
          messages: {
            create: () => {
              diagnosisStarted = true;
              return new Promise(() => {});
            },
          },
        },
        timeoutMs: 100,
      },
    });
    cleanups.push(async () => {
      await Promise.all(handles.map((handle) => handle.close()));
    });

    expect(await new MonitorScheduler(repository, queue).tick(new Date())).toBe(1);
    await eventually(
      async () =>
        (await client.checkRun.count({ where: { monitorId: monitor.id, status: "passed" } })) === 1,
    );
    fixture.setMode("payment_iframe_missing");
    await client.monitor.update({ where: { id: monitor.id }, data: { nextRunAt: new Date(1) } });
    expect(await new MonitorScheduler(repository, queue).tick(new Date())).toBe(1);
    await eventually(
      async () =>
        (await client.incident.count({ where: { monitorId: monitor.id, status: "open" } })) === 1,
    );
    const incident = await client.incident.findFirstOrThrow({ where: { monitorId: monitor.id } });
    expect(
      await client.checkRun.count({ where: { monitorId: monitor.id, status: "failed" } }),
    ).toBe(2);
    const diagnosis = JSON.parse(incident.diagnosisJson ?? "null") as {
      provider?: string;
      summary?: string;
    } | null;
    expect(diagnosis).toMatchObject({ provider: "heuristic" });
    expect(diagnosis?.summary).toContain("payment step");
    await eventually(
      async () =>
        (await client.alertDelivery.count({
          where: { incidentId: incident.id, event: "incident_opened", status: "delivered" },
        })) === 2,
    );
    await eventually(() => Promise.resolve(diagnosisStarted));
    expect(sink.requests).toHaveLength(1);
    const emailLines = (await readFile(join(outboxDir, "email.jsonl"), "utf8")).trim().split("\n");
    expect(emailLines).toHaveLength(1);
    expect(emailLines[0]).toContain("incident_opened");

    await queue.add(
      "dispatch-alert",
      { event: "incident_opened", incidentId: incident.id },
      { jobId: "duplicate-alert-1" },
    );
    await queue.add(
      "dispatch-alert",
      { event: "incident_opened", incidentId: incident.id },
      { jobId: "duplicate-alert-2" },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      await client.alertDelivery.count({
        where: { incidentId: incident.id, event: "incident_opened" },
      }),
    ).toBe(2);
    expect(
      (await readFile(join(outboxDir, "email.jsonl"), "utf8")).trim().split("\n"),
    ).toHaveLength(1);
    expect(sink.requests).toHaveLength(1);

    fixture.setMode("ok");
    await queue.add(
      "run-check",
      { monitorId: monitor.id, trigger: "manual" },
      { jobId: `manual-resolve-${monitor.id}` },
    );
    await eventually(
      async () =>
        (await client.incident.findUniqueOrThrow({ where: { id: incident.id } })).status ===
        "resolved",
    );
    await eventually(
      async () =>
        (await client.alertDelivery.count({
          where: { incidentId: incident.id, event: "incident_resolved", status: "delivered" },
        })) === 2,
    );
    expect(sink.requests).toHaveLength(2);
  }, 15_000);
});

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("incident pipeline timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
