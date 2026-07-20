import { createPrismaClient } from "@checkoutwatch/db";
import { getConfig } from "@checkoutwatch/core/server";
import { diagnoseRun } from "./diagnose-run.js";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: pnpm demo:diagnose <runId>");
const config = getConfig();
const client = createPrismaClient(config.databaseUrl);
try {
  const diagnosis = await diagnoseRun(client, runId, {
    ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
    provider: config.diagnosisProvider,
    model: config.llmModel,
  });
  console.log(JSON.stringify(diagnosis, null, 2));
} finally {
  await client.$disconnect();
}
