import {
  DiscordWebhookAdapter,
  MockAdapter,
  ResendEmailAdapter,
  SlackWebhookAdapter,
  TwilioSmsAdapter,
  type AlertChannelAdapter,
} from "@checkoutwatch/alerts";
import { getConfig, type AppConfig } from "@checkoutwatch/core/server";
import {
  createPrismaClient,
  PrismaMonitorRunRepository,
  PrismaStoreChangeRepository,
} from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { createJobQueue, type JobQueue, type ProcessorHandle } from "@checkoutwatch/queue";
import {
  createShopifyAdminFactory,
  registerJobs,
  MonitorScheduler,
  startScheduler,
} from "@checkoutwatch/worker";

export interface WebRuntime {
  config: AppConfig;
  client: ReturnType<typeof createPrismaClient>;
  queue: JobQueue;
  adapters: readonly AlertChannelAdapter[];
}

let runtimePromise: Promise<WebRuntime> | undefined;

export function getWebRuntime(): Promise<WebRuntime> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

async function createRuntime(): Promise<WebRuntime> {
  const config = getConfig();
  const client = createPrismaClient(config.databaseUrl);
  const queue = createJobQueue(config);
  const adapters = alertAdapters(config);
  if (config.inlineWorker) {
    const repository = new PrismaMonitorRunRepository(client);
    const runner = new CheckoutRunner({
      artifactStore: new LocalArtifactStore(config.artifactDir),
      controlProbeUrl: config.controlProbeUrl,
      knownPaymentOrigins: config.knownPaymentOrigins,
    });
    const handles = await registerJobs(queue, repository, runner, config.engineConcurrency, {
      client,
      adapters,
      incident: {
        recheckDelayMs: config.recheckDelaySeconds * 1000,
        reopenCooldownMs: config.reopenCooldownMinutes * 60_000,
        productUnavailableAutopause: config.productUnavailableAutopause,
        diagnosis: diagnosisOptions(config),
      },
      diagnosis: diagnosisOptions(config),
      changePolling: {
        repository: new PrismaStoreChangeRepository(client),
        shopify: createShopifyAdminFactory(config),
      },
    });
    const scheduler = startScheduler(new MonitorScheduler(repository, queue));
    registerShutdown(client, queue, handles, scheduler);
  }
  return { config, client, queue, adapters };
}

function diagnosisOptions(config: AppConfig) {
  return {
    provider: config.diagnosisProvider,
    model: config.llmModel,
    ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
  } as const;
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

function registerShutdown(
  client: ReturnType<typeof createPrismaClient>,
  queue: JobQueue,
  handles: ProcessorHandle[],
  scheduler: { close(): void },
) {
  const close = async () => {
    scheduler.close();
    await Promise.all(handles.map((handle) => handle.close()));
    await queue.close();
    await client.monitor.updateMany({
      where: { runningAt: { not: null } },
      data: { runningAt: null },
    });
    await client.$disconnect();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
