import type { PrismaClient } from "@prisma/client";
import { PLAN_ENTITLEMENTS } from "@checkoutwatch/core";
import {
  createDiagnoser,
  type AnthropicMessagesClient,
  type Diagnosis,
} from "@checkoutwatch/diagnosis";
import { FailureContextBuilder } from "./failure-context.js";

export interface DiagnoseRunOptions {
  apiKey?: string;
  provider?: "heuristic" | "anthropic";
  model?: string;
  client?: AnthropicMessagesClient;
  allowLlm?: boolean;
  onFallback?: (error: unknown) => void;
}

export async function diagnoseRun(
  client: PrismaClient,
  runId: string,
  options: DiagnoseRunOptions = {},
): Promise<Diagnosis> {
  const run = await client.checkRun.findUnique({
    where: { id: runId },
    include: { monitor: { include: { shop: { select: { plan: true } } } } },
  });
  if (!run) throw new Error(`CheckRun ${runId} was not found`);
  const allowLlm =
    options.allowLlm ??
    ((run.monitor.shop.plan === "growth" || run.monitor.shop.plan === "pro") &&
      PLAN_ENTITLEMENTS[run.monitor.shop.plan].aiDiagnosis);
  if (!allowLlm && options.allowLlm !== false) {
    await client.entitlementLog.create({
      data: {
        shopId: run.monitor.shopId,
        feature: "ai_diagnosis",
        reason: `skipped: AI diagnosis is not included in plan ${run.monitor.shop.plan}`,
        metadataJson: JSON.stringify({ runId }),
      },
    });
  }
  const context = await new FailureContextBuilder(client).build(runId);
  const diagnoser = createDiagnoser({
    allowLlm,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.client ? { client: options.client } : {}),
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  });
  return diagnoser.diagnose(context);
}
