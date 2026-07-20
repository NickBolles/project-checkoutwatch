import type { PrismaClient } from "@prisma/client";
import type { AlertChannelAdapter } from "@checkoutwatch/alerts";
import type { CheckoutRunner } from "@checkoutwatch/engine";
import type { JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import type { ShopifyAdmin } from "@checkoutwatch/shopify";
import type { DiagnoseRunOptions } from "../diagnose-run.js";
import { IncidentService, type IncidentServiceOptions } from "../incident-service.js";
import {
  createDiagnoseIncidentHandler,
  type DiagnoseIncidentPayload,
} from "./diagnose-incident.js";
import { createDispatchAlertHandler, type DispatchAlertPayload } from "./dispatch-alert.js";
import {
  createPollStoreChangesHandler,
  type StoreChangePollRepository,
} from "./poll-store-changes.js";
import {
  createRunCheckHandler,
  type RunCheckPayload,
  type RunCheckRepository,
} from "./run-check.js";
import { createReconcilePlanHandler, type ReconcilePlanPayload } from "./reconcile-plan.js";
import { createRetentionHandler } from "./retention.js";
import { logger } from "@checkoutwatch/core/server";

export interface RegisterJobsOptions {
  client?: PrismaClient;
  adapters?: readonly AlertChannelAdapter[];
  mockOutboxDir?: string;
  incident?: IncidentServiceOptions;
  diagnosis?: DiagnoseRunOptions & { timeoutMs?: number };
  changePolling?: {
    repository: StoreChangePollRepository;
    shopify: Pick<ShopifyAdmin, "getMainTheme">;
  };
  artifactDir?: string;
}

export async function registerJobs(
  queue: JobQueue,
  repository: RunCheckRepository,
  runner: Pick<CheckoutRunner, "run">,
  concurrency: number,
  options: RegisterJobsOptions = {},
): Promise<ProcessorHandle[]> {
  const guarded =
    <T>(
      name: string,
      handler: (
        payload: T,
        context: { id: string; name: string; attempt: number },
      ) => Promise<unknown>,
    ) =>
    async (payload: T, context: { id: string; name: string; attempt: number }) => {
      const startedAt = Date.now();
      try {
        await handler(payload, context);
        logger.info(
          {
            job: name,
            jobId: context.id,
            attempt: context.attempt,
            durationMs: Date.now() - startedAt,
          },
          "job completed",
        );
      } catch (error) {
        logger.error(
          { err: error, job: name, jobId: context.id, attempt: context.attempt, payload },
          "job failed; queue retry or dead-letter policy applies",
        );
        throw error;
      }
    };
  const incidentService = options.client
    ? new IncidentService(options.client, queue, options.incident)
    : undefined;
  const runCheck = createRunCheckHandler(repository, runner, {
    ...(incidentService
      ? { afterPersist: (runId) => incidentService.processRunResult(runId) }
      : {}),
  });
  const handles = [
    await queue.process<RunCheckPayload>(
      "run-check",
      guarded("run-check", async (payload, context) => {
        await runCheck(payload, context);
      }),
      { concurrency },
    ),
    await queue.process<RunCheckPayload>(
      "recheck",
      guarded("recheck", async (payload, context) => {
        await runCheck({ ...payload, trigger: "recheck" }, context);
      }),
      { concurrency },
    ),
  ];
  if (options.client) {
    const dispatch = createDispatchAlertHandler(
      options.client,
      options.adapters ?? [],
      options.mockOutboxDir ? { mockOutboxDir: options.mockOutboxDir } : {},
    );
    const diagnose = createDiagnoseIncidentHandler(options.client, options.diagnosis);
    handles.push(
      await queue.process<DispatchAlertPayload>(
        "dispatch-alert",
        guarded("dispatch-alert", async (payload) => {
          await dispatch(payload);
        }),
      ),
    );
    handles.push(
      await queue.process<DiagnoseIncidentPayload>(
        "diagnose-incident",
        guarded("diagnose-incident", async (payload) => {
          await diagnose(payload);
        }),
      ),
    );
    const reconcilePlan = createReconcilePlanHandler(options.client);
    handles.push(await queue.process<ReconcilePlanPayload>("reconcile-plan", reconcilePlan));
    const retention = createRetentionHandler(
      options.client,
      options.artifactDir ?? "var/artifacts",
    );
    handles.push(
      await queue.process(
        "retention",
        guarded("retention", async (payload) => retention(payload)),
      ),
    );
  } else {
    handles.push(await queue.process("dispatch-alert", async () => {}));
    handles.push(await queue.process("diagnose-incident", async () => {}));
    handles.push(await queue.process("reconcile-plan", async () => {}));
    handles.push(await queue.process("retention", async () => {}));
  }
  if (options.changePolling) {
    const poll = createPollStoreChangesHandler(
      options.changePolling.repository,
      options.changePolling.shopify,
    );
    handles.push(
      await queue.process("poll-store-changes", async () => {
        await poll();
      }),
    );
  } else {
    handles.push(await queue.process("poll-store-changes", async () => {}));
  }
  return handles;
}
