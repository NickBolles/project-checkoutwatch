import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createPrismaClient, PrismaMonitorRunRepository } from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { MemoryDriver } from "@checkoutwatch/queue";
import { startStorefrontFixture } from "@checkoutwatch/storefront-fixture";
import { registerJobs } from "./jobs/index.js";
import { MonitorScheduler } from "./scheduler.js";

const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-demo-incident-"));
const databasePath = join(directory, "demo.db");
await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
const fixture = await startStorefrontFixture();
const browser = await chromium.launch({ headless: true });
const queue = new MemoryDriver();
const repository = new PrismaMonitorRunRepository(client);
const runner = new CheckoutRunner({
  browser,
  artifactStore: new LocalArtifactStore(join(directory, "artifacts")),
  controlProbeUrl: fixture.controlUrl,
  knownPaymentOrigins: [fixture.paymentOrigin],
});
const handles = await registerJobs(queue, repository, runner, 1, {
  client,
  mockOutboxDir: join(directory, "outbox"),
  incident: { recheckDelayMs: 5 },
});

try {
  await client.monitor.updateMany({ data: { enabled: false } });
  const shop = await client.shop.create({
    data: {
      shopDomain: `demo-${Date.now()}.test`,
      storefrontUrl: fixture.storefrontUrl,
      plan: "free",
    },
  });
  await client.alertChannelConfig.create({
    data: { shopId: shop.id, type: "email", destination: "mock://merchant@example.test" },
  });
  const monitor = await client.monitor.create({
    data: {
      shopId: shop.id,
      name: "Demo checkout",
      productHandle: "test-product",
      productTitle: "Fixture product",
      variantId: "1001",
      nextRunAt: new Date(0),
    },
  });
  fixture.setMode("payment_iframe_missing");
  await new MonitorScheduler(repository, queue).tick(new Date());
  await eventually(
    async () => (await client.incident.count({ where: { monitorId: monitor.id } })) === 1,
  );
  const runs = await client.checkRun.findMany({
    where: { monitorId: monitor.id },
    orderBy: { startedAt: "asc" },
  });
  const incident = await client.incident.findFirstOrThrow({ where: { monitorId: monitor.id } });
  await eventually(
    async () =>
      (await client.alertDelivery.count({
        where: { incidentId: incident.id, event: "incident_opened", status: "delivered" },
      })) === 1,
  );
  console.log(`runs: ${runs.map((run) => `${run.triggeredBy}=${run.status}`).join(" -> ")}`);
  console.log(`incident: ${incident.id} (${incident.failureCode})`);
  console.log(`diagnosis: ${diagnosisSummary(incident.diagnosisJson)}`);
  console.log(
    `delivery log: ${(await client.alertDelivery.findMany({ where: { incidentId: incident.id } })).map((delivery) => `${delivery.channelType}:${delivery.status}`).join(", ")}`,
  );
  fixture.setMode("ok");
  await queue.add(
    "run-check",
    { monitorId: monitor.id, trigger: "manual" },
    { jobId: `demo-resolve:${monitor.id}` },
  );
  await eventually(
    async () =>
      (await client.incident.findUniqueOrThrow({ where: { id: incident.id } })).status ===
      "resolved",
  );
  console.log("recovery: incident resolved and resolution alert queued");
} finally {
  await Promise.all(handles.map((handle) => handle.close()));
  await queue.close();
  await browser.close();
  await fixture.close();
  await client.$disconnect();
}

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("demo incident timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function diagnosisSummary(value: string | null): string {
  if (!value) return "No diagnosis available";
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === "object" &&
    parsed !== null &&
    "summary" in parsed &&
    typeof parsed.summary === "string"
    ? parsed.summary
    : "No diagnosis available";
}
