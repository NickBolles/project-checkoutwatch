import type { PrismaClient } from "@prisma/client";
import type { PlanName } from "@checkoutwatch/core";
import { writeJson } from "./json.js";
import { PrismaStoreChangeRepository } from "./store-change-repository.js";

export interface PersistableCheckRun {
  runId: string;
  status: "passed" | "failed" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: { name: string; durationMs: number; httpStatus?: number }[];
  console: { type: "warning" | "error"; text: string }[];
  failedRequests: { url: string; method: string; status?: number; error?: string }[];
  scriptOrigins: string[];
  failureStep?: string;
  failureCode?: string;
  failureMessage?: string;
  screenshotPath?: string;
}

export interface DueMonitor {
  id: string;
  nextRunAt: Date;
  intervalMinutes: number;
  plan: PlanName;
}

export interface RunnableMonitor {
  id: string;
  productHandle: string;
  variantId?: string;
  storefrontUrl: string;
}

export class PrismaMonitorRunRepository {
  constructor(private readonly client: PrismaClient) {}

  async dueMonitors(now: Date, limit: number): Promise<DueMonitor[]> {
    const rows = await this.client.monitor.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      include: { shop: { select: { plan: true } } },
      orderBy: { nextRunAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      nextRunAt: row.nextRunAt,
      intervalMinutes: row.intervalMinutes,
      plan: normalizePlan(row.shop.plan),
    }));
  }

  async claimSchedule(id: string, seenNextRunAt: Date, nextRunAt: Date): Promise<boolean> {
    const result = await this.client.monitor.updateMany({
      where: { id, enabled: true, nextRunAt: seenNextRunAt },
      data: { nextRunAt },
    });
    return result.count === 1;
  }

  async hasJobRun(jobKey: string): Promise<boolean> {
    return (await this.client.checkRun.count({ where: { triggeredBy: jobKey } })) > 0;
  }

  async acquireRunLock(
    monitorId: string,
    now: Date,
    staleBefore: Date,
  ): Promise<RunnableMonitor | null> {
    const claimed = await this.client.monitor.updateMany({
      where: {
        id: monitorId,
        enabled: true,
        OR: [{ runningAt: null }, { runningAt: { lt: staleBefore } }],
      },
      data: { runningAt: now },
    });
    if (claimed.count !== 1) return null;
    const monitor = await this.client.monitor.findUnique({
      where: { id: monitorId },
      include: { shop: { select: { storefrontUrl: true } } },
    });
    if (!monitor) return null;
    return {
      id: monitor.id,
      productHandle: monitor.productHandle,
      ...(monitor.variantId ? { variantId: monitor.variantId } : {}),
      storefrontUrl: monitor.shop.storefrontUrl,
    };
  }

  async persistRun(monitorId: string, jobKey: string, result: PersistableCheckRun): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      if (await transaction.checkRun.count({ where: { triggeredBy: jobKey } })) return;
      await transaction.checkRun.create({
        data: {
          id: result.runId,
          monitorId,
          status: result.status,
          triggeredBy: jobKey,
          startedAt: new Date(result.startedAt),
          finishedAt: new Date(result.finishedAt),
          durationMs: result.durationMs,
          stepTimingsJson: writeJson(
            result.steps.map((step) => ({
              step: step.name,
              ms: step.durationMs,
              ...(step.httpStatus === undefined ? {} : { httpStatus: step.httpStatus }),
            })),
          ),
          ...(result.failureStep ? { failureStep: result.failureStep } : {}),
          ...(result.failureCode ? { failureCode: result.failureCode } : {}),
          ...(result.failureMessage ? { failureMessage: result.failureMessage } : {}),
          ...(result.screenshotPath ? { screenshotPath: result.screenshotPath } : {}),
          consoleJson: writeJson(
            result.console.map((entry) => ({
              level: entry.type === "warning" ? "warn" : "error",
              text: entry.text,
            })),
          ),
          failedRequestsJson: writeJson(result.failedRequests),
          scriptOriginsJson: writeJson(result.scriptOrigins),
        },
      });
      await transaction.monitor.update({
        where: { id: monitorId },
        data: {
          lastRunAt: new Date(result.finishedAt),
          lastStatus: result.status,
        },
      });
    });
  }

  async clearRunLock(monitorId: string, acquiredAt: Date): Promise<void> {
    await this.client.monitor.updateMany({
      where: { id: monitorId, runningAt: acquiredAt },
      data: { runningAt: null },
    });
  }

  async recordScriptOriginDiff(runId: string): Promise<void> {
    await new PrismaStoreChangeRepository(this.client).recordScriptOriginDiff(runId);
  }
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}
