import type { PrismaClient } from "@prisma/client";
import { writeJson } from "./json.js";

export interface ProcessableRun {
  id: string;
  monitorId: string;
  status: "passed" | "failed" | "error";
  failureCode?: string;
  monitor: {
    consecutiveFails: number;
    consecutiveErrors: number;
    openIncidentId?: string;
    enabled: boolean;
  };
  recentlyResolved?: { id: string; resolvedAt: Date };
  consecutiveProductUnavailable: number;
}

export interface IncidentAlertContext {
  incidentId: string;
  monitorId: string;
  monitorName: string;
  storeUrl: string;
  shopId: string;
  plan: string;
  diagnosisJson?: string;
  routes: Array<{ channel: string; destination: string; enabled: boolean }>;
}

export class PrismaIncidentRepository {
  constructor(private readonly client: PrismaClient) {}

  async loadRunState(runId: string): Promise<ProcessableRun> {
    const run = await this.client.checkRun.findUnique({
      where: { id: runId },
      include: { monitor: true },
    });
    if (!run) throw new Error(`CheckRun ${runId} was not found`);
    if (run.status !== "passed" && run.status !== "failed" && run.status !== "error")
      throw new Error(`CheckRun ${runId} has invalid status ${run.status}`);
    const [resolved, previousRuns] = await Promise.all([
      this.client.incident.findFirst({
        where: { monitorId: run.monitorId, status: "resolved", resolvedAt: { not: null } },
        orderBy: { resolvedAt: "desc" },
        select: { id: true, resolvedAt: true },
      }),
      this.client.checkRun.findMany({
        where: { monitorId: run.monitorId, startedAt: { lt: run.startedAt } },
        orderBy: { startedAt: "desc" },
        take: 100,
        select: { status: true, failureCode: true },
      }),
    ]);
    return {
      id: run.id,
      monitorId: run.monitorId,
      status: run.status,
      ...(run.failureCode ? { failureCode: run.failureCode } : {}),
      monitor: {
        consecutiveFails: countFailures(previousRuns),
        consecutiveErrors: countErrors(previousRuns),
        ...(run.monitor.openIncidentId ? { openIncidentId: run.monitor.openIncidentId } : {}),
        enabled: run.monitor.enabled,
      },
      ...(resolved?.resolvedAt
        ? { recentlyResolved: { id: resolved.id, resolvedAt: resolved.resolvedAt } }
        : {}),
      consecutiveProductUnavailable: countProductUnavailable(previousRuns),
    };
  }

  async updateMonitorState(
    monitorId: string,
    state: { consecutiveFails: number; consecutiveErrors: number; enabled: boolean },
  ): Promise<void> {
    await this.client.monitor.update({ where: { id: monitorId }, data: state });
  }

  async recentChanges(
    shopId: string,
    since: Date,
  ): Promise<Array<{ kind: string; detectedAt: string; detail: unknown }>> {
    const events = await this.client.storeChangeEvent.findMany({
      where: { shopId, detectedAt: { gte: since } },
      orderBy: { detectedAt: "desc" },
    });
    return events.map((event) => ({
      kind: event.kind,
      detectedAt: event.detectedAt.toISOString(),
      detail: parseJson(event.detailJson),
    }));
  }

  async monitorShop(monitorId: string): Promise<{ shopId: string; plan: string }> {
    const monitor = await this.client.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      include: { shop: { select: { id: true, plan: true } } },
    });
    return { shopId: monitor.shop.id, plan: monitor.shop.plan };
  }

  async openIncident(input: {
    monitorId: string;
    runId: string;
    failureCode: string;
    diagnosis: unknown;
    changes: unknown[];
    openedAt: Date;
  }): Promise<string> {
    return this.client.$transaction(async (transaction) => {
      const incident = await transaction.incident.create({
        data: {
          monitorId: input.monitorId,
          openingRunId: input.runId,
          failureCode: input.failureCode,
          openedAt: input.openedAt,
          diagnosisJson: writeJson(input.diagnosis),
          changeContextJson: writeJson(input.changes),
        },
      });
      const claimed = await transaction.monitor.updateMany({
        where: { id: input.monitorId, openIncidentId: null },
        data: { openIncidentId: incident.id },
      });
      if (claimed.count !== 1)
        throw new Error(`Monitor ${input.monitorId} already has an open incident`);
      return incident.id;
    });
  }

  async reopenIncident(
    incidentId: string,
    monitorId: string,
    runId: string,
    failureCode: string,
  ): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.incident.update({
        where: { id: incidentId },
        data: {
          status: "open",
          resolvedAt: null,
          resolvingRunId: null,
          reopenCount: { increment: 1 },
          failureCode,
        },
      });
      const claimed = await transaction.monitor.updateMany({
        where: { id: monitorId, openIncidentId: null },
        data: { openIncidentId: incidentId },
      });
      if (claimed.count !== 1)
        throw new Error(
          `Monitor ${monitorId} could not reopen incident ${incidentId} for run ${runId}`,
        );
    });
  }

  async resolveIncident(
    incidentId: string,
    monitorId: string,
    runId: string,
    resolvedAt: Date,
  ): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      const closed = await transaction.incident.updateMany({
        where: { id: incidentId, status: "open", resolvedAt: null },
        data: { status: "resolved", resolvedAt, resolvingRunId: runId },
      });
      if (closed.count !== 1) return false;
      await transaction.monitor.updateMany({
        where: { id: monitorId, openIncidentId: incidentId },
        data: { openIncidentId: null },
      });
      return true;
    });
  }

  async alertContext(incidentId: string): Promise<IncidentAlertContext> {
    const incident = await this.client.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: { monitor: { include: { shop: { include: { channels: true } } } } },
    });
    return {
      incidentId: incident.id,
      monitorId: incident.monitorId,
      monitorName: incident.monitor.name,
      storeUrl: incident.monitor.shop.storefrontUrl,
      shopId: incident.monitor.shopId,
      plan: incident.monitor.shop.plan,
      ...(incident.diagnosisJson ? { diagnosisJson: incident.diagnosisJson } : {}),
      routes: incident.monitor.shop.channels.map((route) => ({
        channel: route.type,
        destination: route.destination,
        enabled: route.enabled,
      })),
    };
  }

  async monitorAttentionContext(
    monitorId: string,
  ): Promise<Omit<IncidentAlertContext, "incidentId">> {
    const monitor = await this.client.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      include: { shop: { include: { channels: true } } },
    });
    return {
      monitorId,
      monitorName: monitor.name,
      storeUrl: monitor.shop.storefrontUrl,
      shopId: monitor.shopId,
      plan: monitor.shop.plan,
      routes: monitor.shop.channels.map((route) => ({
        channel: route.type,
        destination: route.destination,
        enabled: route.enabled,
      })),
    };
  }

  async updateDiagnosis(incidentId: string, diagnosis: unknown): Promise<void> {
    await this.client.incident.update({
      where: { id: incidentId },
      data: { diagnosisJson: writeJson(diagnosis) },
    });
  }
}

function countProductUnavailable(
  runs: Array<{ status: string; failureCode: string | null }>,
): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "error") continue;
    if (run.status === "failed" && run.failureCode === "PRODUCT_UNAVAILABLE") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function countFailures(runs: Array<{ status: string }>): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "error") continue;
    if (run.status === "failed") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function countErrors(runs: Array<{ status: string }>): number {
  let count = 0;
  for (const run of runs) {
    if (run.status !== "error") break;
    count += 1;
  }
  return count;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
