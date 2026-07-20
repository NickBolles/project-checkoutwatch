import type { CheckRunResult, CheckoutRunner } from "@checkoutwatch/engine";

export interface RunCheckPayload {
  monitorId: string;
  scheduledFor?: string;
  trigger?: "schedule" | "manual" | "recheck";
}
export interface RunnableMonitor {
  id: string;
  productHandle: string;
  variantId?: string;
  storefrontUrl: string;
}
export interface RunCheckRepository {
  hasJobRun(jobKey: string): Promise<boolean>;
  acquireRunLock(monitorId: string, now: Date, staleBefore: Date): Promise<RunnableMonitor | null>;
  persistRun(monitorId: string, jobKey: string, result: CheckRunResult): Promise<void>;
  recordScriptOriginDiff?(runId: string): Promise<unknown>;
  clearRunLock(monitorId: string, acquiredAt: Date): Promise<void>;
}

export type RunCheckDisposition = "completed" | "duplicate" | "skipped";

export function createRunCheckHandler(
  repository: RunCheckRepository,
  runner: Pick<CheckoutRunner, "run">,
  options: {
    timeoutMs?: number;
    staleLockMs?: number;
    now?: () => Date;
    afterPersist?: (runId: string) => Promise<void>;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleLockMs = options.staleLockMs ?? 5 * 60_000;
  const now = options.now ?? (() => new Date());
  return async (
    payload: RunCheckPayload,
    context: { id: string },
  ): Promise<RunCheckDisposition> => {
    const jobKey = `job:${context.id}`;
    if (await repository.hasJobRun(jobKey)) return "duplicate";
    const acquiredAt = now();
    const monitor = await repository.acquireRunLock(
      payload.monitorId,
      acquiredAt,
      new Date(acquiredAt.getTime() - staleLockMs),
    );
    if (!monitor) return "skipped";
    try {
      const result = await runner.run({
        storeUrl: monitor.storefrontUrl,
        productHandle: monitor.productHandle,
        ...(monitor.variantId ? { variantId: monitor.variantId } : {}),
        timeoutMs,
      });
      await repository.persistRun(monitor.id, jobKey, result);
      await repository.recordScriptOriginDiff?.(result.runId);
      await options.afterPersist?.(result.runId);
      return "completed";
    } finally {
      await repository.clearRunLock(payload.monitorId, acquiredAt);
    }
  };
}
