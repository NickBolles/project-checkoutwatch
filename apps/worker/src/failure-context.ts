import type { PrismaClient } from "@prisma/client";
import type {
  FailureChangeEvent,
  FailureContext,
  FailureRunSummary,
} from "@checkoutwatch/diagnosis";
import { diffScriptOrigins } from "@checkoutwatch/db";

export class FailureContextBuilder {
  constructor(
    private readonly client: PrismaClient,
    private readonly changeLookbackMs = 24 * 60 * 60_000,
  ) {}

  async build(runId: string): Promise<FailureContext> {
    const run = await this.client.checkRun.findUnique({
      where: { id: runId },
      include: { monitor: { include: { shop: { select: { storefrontUrl: true } } } } },
    });
    if (!run) throw new Error(`CheckRun ${runId} was not found`);
    if (run.status !== "failed" || !run.failureCode)
      throw new Error(`CheckRun ${runId} is not a diagnosable failed run`);
    const [previousPassing, history, changes] = await Promise.all([
      this.client.checkRun.findFirst({
        where: { monitorId: run.monitorId, status: "passed", startedAt: { lt: run.startedAt } },
        orderBy: { startedAt: "desc" },
        select: { scriptOriginsJson: true },
      }),
      this.client.checkRun.findMany({
        where: { monitorId: run.monitorId, startedAt: { lte: run.startedAt } },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { status: true, startedAt: true, failureCode: true },
      }),
      this.client.storeChangeEvent.findMany({
        where: {
          shopId: run.monitor.shopId,
          detectedAt: {
            gte: new Date(run.startedAt.getTime() - this.changeLookbackMs),
            lte: run.startedAt,
          },
        },
        orderBy: { detectedAt: "desc" },
      }),
    ]);
    const currentOrigins = parseStringArray(run.scriptOriginsJson);
    const previousOrigins = parseStringArray(previousPassing?.scriptOriginsJson ?? "[]");
    return {
      runId: run.id,
      monitorId: run.monitorId,
      storeUrl: run.monitor.shop.storefrontUrl,
      productHandle: run.monitor.productHandle,
      failureCode: run.failureCode,
      ...(run.failureStep ? { failureStep: run.failureStep } : {}),
      ...(run.failureMessage ? { failureMessage: run.failureMessage } : {}),
      consoleErrors: parseArrayOfRecords(run.consoleJson).flatMap((entry) => {
        if ((entry.level !== "warn" && entry.level !== "error") || typeof entry.text !== "string")
          return [];
        return [
          {
            level: entry.level,
            text: entry.text,
            ...(typeof entry.timestamp === "string" ? { timestamp: entry.timestamp } : {}),
          },
        ];
      }),
      failedRequests: parseArrayOfRecords(run.failedRequestsJson).flatMap((entry) => {
        if (typeof entry.url !== "string" || typeof entry.method !== "string") return [];
        return [
          {
            url: entry.url,
            method: entry.method,
            ...(typeof entry.status === "number" ? { status: entry.status } : {}),
            ...(typeof entry.error === "string" ? { error: entry.error } : {}),
          },
        ];
      }),
      scriptOriginDiff: diffScriptOrigins(previousOrigins, currentOrigins),
      recentChanges: changes.map(
        (event): FailureChangeEvent => ({
          kind: event.kind,
          detectedAt: event.detectedAt.toISOString(),
          detail: parseRecord(event.detailJson),
        }),
      ),
      stepTimings: parseArrayOfRecords(run.stepTimingsJson).flatMap((entry) => {
        if (typeof entry.step !== "string" || typeof entry.ms !== "number") return [];
        return [
          {
            step: entry.step,
            ms: entry.ms,
            ...(typeof entry.httpStatus === "number" ? { httpStatus: entry.httpStatus } : {}),
          },
        ];
      }),
      recentRuns: history.flatMap((item): FailureRunSummary[] => {
        if (item.status !== "passed" && item.status !== "failed" && item.status !== "error")
          return [];
        return [
          {
            status: item.status,
            startedAt: item.startedAt.toISOString(),
            ...(item.failureCode ? { failureCode: item.failureCode } : {}),
          },
        ];
      }),
    };
  }
}

function parseArrayOfRecords(value: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item),
        )
      : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
