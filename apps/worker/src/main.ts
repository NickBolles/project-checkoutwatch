import { getConfig, logger, type AppConfig } from "@checkoutwatch/core";
import {
  DiscordWebhookAdapter,
  MockAdapter,
  ResendEmailAdapter,
  SlackWebhookAdapter,
  TwilioSmsAdapter,
  type AlertChannelAdapter,
} from "@checkoutwatch/alerts";
import {
  createPrismaClient,
  PrismaMonitorRunRepository,
  PrismaStoreChangeRepository,
} from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { createJobQueue } from "@checkoutwatch/queue";
import { MockShopifyAdmin } from "@checkoutwatch/shopify";
import { registerJobs } from "./jobs/index.js";
import { MonitorScheduler, startScheduler } from "./scheduler.js";
import { createServer } from "node:http";

export async function startWorker() {
  const config = getConfig();
  const client = createPrismaClient(config.databaseUrl);
  const repository = new PrismaMonitorRunRepository(client);
  const queue = createJobQueue(config);
  const runner = new CheckoutRunner({
    artifactStore: new LocalArtifactStore(config.artifactDir),
    controlProbeUrl: config.controlProbeUrl,
    knownPaymentOrigins: config.knownPaymentOrigins,
  });
  const processors = await registerJobs(queue, repository, runner, config.engineConcurrency, {
    client,
    adapters: alertAdapters(config),
    incident: {
      recheckDelayMs: config.recheckDelaySeconds * 1000,
      reopenCooldownMs: config.reopenCooldownMinutes * 60_000,
      productUnavailableAutopause: config.productUnavailableAutopause,
      diagnosis: {
        ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
        provider: config.diagnosisProvider,
        model: config.llmModel,
      },
    },
    diagnosis: {
      ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
      provider: config.diagnosisProvider,
      model: config.llmModel,
    },
    changePolling: {
      repository: new PrismaStoreChangeRepository(client),
      shopify: new MockShopifyAdmin(config.fixtureStorefrontUrl),
    },
    artifactDir: config.artifactDir,
  });
  const monitorScheduler = new MonitorScheduler(repository, queue);
  const scheduler = startScheduler(monitorScheduler);
  const enqueueChangePoll = () =>
    queue.add(
      "poll-store-changes",
      {},
      { jobId: `theme-poll:${Math.floor(Date.now() / 3_600_000)}` },
    );
  await enqueueChangePoll();
  const enqueueRetention = () =>
    queue.add("retention", {}, { jobId: `retention:${new Date().toISOString().slice(0, 10)}` });
  await enqueueRetention();
  const changePollTimer = setInterval(() => {
    void enqueueChangePoll();
  }, 3_600_000);
  const retentionTimer = setInterval(() => void enqueueRetention(), 86_400_000);
  const healthServer = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404).end("not found");
      return;
    }
    void client.$queryRawUnsafe("SELECT 1").then(
      () =>
        response
          .writeHead(200, { "content-type": "application/json" })
          .end('{"ok":true,"service":"worker"}'),
      () =>
        response
          .writeHead(503, { "content-type": "application/json" })
          .end('{"ok":false,"service":"worker"}'),
    );
  });
  healthServer.listen(config.workerHealthPort, "0.0.0.0");
  await monitorScheduler.tick();
  logger.info({ queueDriver: config.queueDriver }, "CheckoutWatch worker started");
  return {
    async close() {
      scheduler.close();
      clearInterval(changePollTimer);
      clearInterval(retentionTimer);
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      await Promise.all(processors.map((processor) => processor.close()));
      await queue.close();
      await client.monitor.updateMany({
        where: { runningAt: { not: null } },
        data: { runningAt: null },
      });
      await client.$disconnect();
    },
  };
}

function alertAdapters(config: AppConfig): AlertChannelAdapter[] {
  if (config.alertTransport === "mock")
    return (["email", "slack", "discord", "sms"] as const).map((type) => new MockAdapter(type));
  const adapters: AlertChannelAdapter[] = [new SlackWebhookAdapter(), new DiscordWebhookAdapter()];
  if (config.resendApiKey)
    adapters.push(
      new ResendEmailAdapter({
        apiKey: config.resendApiKey,
        from: "CheckoutWatch <alerts@checkoutwatch.app>",
        ...(config.resendWebhookSecret ? { webhookSecret: config.resendWebhookSecret } : {}),
      }),
    );
  if (config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber)
    adapters.push(
      new TwilioSmsAdapter({
        accountSid: config.twilioAccountSid,
        authToken: config.twilioAuthToken,
        from: config.twilioFromNumber,
      }),
    );
  return adapters;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href
) {
  const worker = await startWorker();
  const shutdown = () => void worker.close().finally(() => process.exit());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("unhandledRejection", (error) =>
    logger.fatal({ err: error }, "unhandled worker rejection"),
  );
  process.on("uncaughtException", (error) =>
    logger.fatal({ err: error }, "uncaught worker exception"),
  );
}
