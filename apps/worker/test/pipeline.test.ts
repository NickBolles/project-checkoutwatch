import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, PrismaMonitorRunRepository } from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { MemoryDriver } from "@checkoutwatch/queue";
import { startStorefrontFixture } from "@checkoutwatch/storefront-fixture";
import { createRunCheckHandler } from "../src/jobs/run-check.js";
import { MonitorScheduler } from "../src/scheduler.js";

describe("scheduler to persisted CheckRun @e2e-lite", () => {
  const resources: (() => Promise<void>)[] = [];
  afterAll(async () => { await Promise.all(resources.map((close) => close())); });

  it("seeds a due monitor, executes the local checkout, and persists timings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-worker-"));
    const databasePath = join(directory, "test.db");
    await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
    const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
    resources.push(() => client.$disconnect());
    const fixture = await startStorefrontFixture();
    resources.push(() => fixture.close());
    const browser = await chromium.launch({ headless: true });
    resources.push(() => browser.close());
    await client.monitor.updateMany({ data: { enabled: false } });
    const shop = await client.shop.create({ data: { shopDomain: `pipeline-${Date.now()}.example.test`, storefrontUrl: fixture.storefrontUrl, plan: "free" } });
    const monitor = await client.monitor.create({ data: { shopId: shop.id, name: "Pipeline", productHandle: "test-product", productTitle: "Test", variantId: "1001", nextRunAt: new Date(0) } });
    const repository = new PrismaMonitorRunRepository(client);
    const queue = new MemoryDriver();
    resources.push(() => queue.close());
    const runner = new CheckoutRunner({ browser, artifactStore: new LocalArtifactStore(directory), controlProbeUrl: fixture.controlUrl, knownPaymentOrigins: [fixture.paymentOrigin] });
    const handler = createRunCheckHandler(repository, runner, { timeoutMs: 1000 });
    await queue.process("run-check", async (payload: { monitorId: string }, context) => { await handler(payload, context); });
    expect(await new MonitorScheduler(repository, queue).tick(new Date())).toBe(1);
    await eventually(async () => (await client.checkRun.count({ where: { monitorId: monitor.id } })) === 1);
    const run = await client.checkRun.findFirstOrThrow({ where: { monitorId: monitor.id } });
    expect(run.status).toBe("passed");
    expect(JSON.parse(run.stepTimingsJson)).toHaveLength(4);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });
});

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("pipeline timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
