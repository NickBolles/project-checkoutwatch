import { getConfig, logger } from "@checkoutwatch/core";
import { createPrismaClient, PrismaMonitorRunRepository } from "@checkoutwatch/db";
import { CheckoutRunner, LocalArtifactStore } from "@checkoutwatch/engine";
import { createJobQueue } from "@checkoutwatch/queue";
import { registerJobs } from "./jobs/index.js";
import { MonitorScheduler, startScheduler } from "./scheduler.js";

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
  const processors = await registerJobs(queue, repository, runner, config.engineConcurrency);
  const monitorScheduler = new MonitorScheduler(repository, queue);
  const scheduler = startScheduler(monitorScheduler);
  await monitorScheduler.tick();
  logger.info({ queueDriver: config.queueDriver }, "CheckoutWatch worker started");
  return {
    async close() {
      scheduler.close();
      await Promise.all(processors.map((processor) => processor.close()));
      await queue.close();
      await client.$disconnect();
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  await startWorker();
}
