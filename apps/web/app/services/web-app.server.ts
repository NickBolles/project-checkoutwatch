import { AlertDispatcher, type AlertMessage, type AlertRoute } from "@checkoutwatch/alerts";
import {
  canUseChannel,
  clampInterval,
  maxMonitors,
  type ChannelType,
  type PlanName,
} from "@checkoutwatch/core";
import { PrismaDeliveryLogStore } from "@checkoutwatch/db";
import type { PrismaClient } from "@prisma/client";
import type { JobQueue } from "@checkoutwatch/queue";
import type { AlertChannelAdapter } from "@checkoutwatch/alerts";

export interface UptimeSummary {
  uptime: number | null;
  passed: number;
  failed: number;
  excluded: number;
}

export function aggregateUptime(runs: readonly { status: string }[]): UptimeSummary {
  const passed = runs.filter((run) => run.status === "passed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const denominator = passed + failed;
  return {
    uptime: denominator === 0 ? null : (passed / denominator) * 100,
    passed,
    failed,
    excluded: runs.length - denominator,
  };
}

export class WebAppService {
  constructor(
    private readonly client: PrismaClient,
    private readonly queue: JobQueue,
    private readonly adapters: readonly AlertChannelAdapter[],
  ) {}

  async dashboard(shopId: string) {
    const now = Date.now();
    const monitors = await this.client.monitor.findMany({
      where: { shopId },
      include: {
        runs: {
          where: { startedAt: { gte: new Date(now - 30 * 86_400_000) } },
          orderBy: { startedAt: "asc" },
        },
        incidents: { orderBy: { openedAt: "desc" }, take: 10 },
      },
      orderBy: { name: "asc" },
    });
    return monitors.map((monitor) => {
      const last7 = monitor.runs.filter((run) => run.startedAt.getTime() >= now - 7 * 86_400_000);
      return {
        id: monitor.id,
        name: monitor.name,
        enabled: monitor.enabled,
        lastStatus: monitor.lastStatus,
        lastRunAt: monitor.lastRunAt?.toISOString(),
        uptime7: aggregateUptime(last7).uptime,
        uptime30: aggregateUptime(monitor.runs).uptime,
        responseTimes: monitor.runs
          .filter((run) => run.durationMs !== null)
          .slice(-20)
          .map((run) => run.durationMs as number),
        openIncident: monitor.incidents.find((incident) => incident.status === "open") ?? null,
        incidents: monitor.incidents.map((incident) => ({
          id: incident.id,
          status: incident.status,
          failureCode: incident.failureCode,
          openedAt: incident.openedAt.toISOString(),
          resolvedAt: incident.resolvedAt?.toISOString(),
        })),
      };
    });
  }

  async reconciliation(shopId: string) {
    const shop = await this.client.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { reconciliationJson: true },
    });
    return parseJson<Record<string, unknown>>(shop.reconciliationJson, {});
  }

  async createMonitor(input: {
    shopId: string;
    plan: PlanName;
    product: { handle: string; title: string; variantId?: string };
    requestedInterval: number;
  }) {
    const existing = await this.client.monitor.count({
      where: { shopId: input.shopId, enabled: true },
    });
    if (existing >= maxMonitors(input.plan)) {
      await this.logEntitlement(
        input.shopId,
        "monitor_create",
        `blocked: ${input.plan} allows ${maxMonitors(input.plan)} active monitor(s)`,
        { activeMonitors: existing },
      );
      throw new Response(
        `Your ${input.plan} plan allows ${maxMonitors(input.plan)} active monitor(s).`,
        {
          status: 403,
        },
      );
    }
    const intervalMinutes = clampInterval(input.plan, input.requestedInterval);
    if (intervalMinutes !== input.requestedInterval)
      await this.logEntitlement(
        input.shopId,
        "interval",
        `clamped to ${intervalMinutes} minutes for ${input.plan}`,
        { requested: input.requestedInterval },
        "clamped",
      );
    const monitor = await this.client.monitor.create({
      data: {
        shopId: input.shopId,
        name: `${input.product.title} checkout`,
        productHandle: input.product.handle,
        productTitle: input.product.title,
        ...(input.product.variantId ? { variantId: input.product.variantId } : {}),
        intervalMinutes,
        nextRunAt: new Date(Date.now() + intervalMinutes * 60_000),
      },
    });
    await this.queue.add(
      "run-check",
      { monitorId: monitor.id, trigger: "manual" },
      { jobId: `first-run:${monitor.id}` },
    );
    return monitor;
  }

  async monitor(shopId: string, monitorId: string) {
    return this.client.monitor.findFirstOrThrow({
      where: { id: monitorId, shopId },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 100 } },
    });
  }

  async setMonitorEnabled(shopId: string, monitorId: string, enabled: boolean) {
    const result = await this.client.monitor.updateMany({
      where: { id: monitorId, shopId },
      data: { enabled, ...(enabled ? { nextRunAt: new Date() } : { runningAt: null }) },
    });
    if (result.count !== 1) throw new Response("Monitor not found", { status: 404 });
  }

  async runNow(shopId: string, monitorId: string) {
    const monitor = await this.client.monitor.findFirst({
      where: { id: monitorId, shopId, enabled: true },
    });
    if (!monitor) throw new Response("Enabled monitor not found", { status: 404 });
    await this.queue.add(
      "run-check",
      { monitorId, trigger: "manual" },
      { jobId: `manual:${monitorId}:${Date.now()}` },
    );
  }

  async incident(shopId: string, incidentId: string) {
    const incident = await this.client.incident.findFirstOrThrow({
      where: { id: incidentId, monitor: { shopId } },
      include: { monitor: true },
    });
    const [openingRun, changes, deliveries, runs] = await Promise.all([
      this.client.checkRun.findUniqueOrThrow({ where: { id: incident.openingRunId } }),
      this.client.storeChangeEvent.findMany({
        where: { shopId, detectedAt: { lte: incident.openedAt } },
        orderBy: { detectedAt: "desc" },
        take: 20,
      }),
      this.client.alertDelivery.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } }),
      this.client.checkRun.findMany({
        where: {
          monitorId: incident.monitorId,
          startedAt: { gte: new Date(incident.openedAt.getTime() - 3_600_000) },
        },
        orderBy: { startedAt: "asc" },
      }),
    ]);
    return {
      ...incident,
      diagnosis: parseJson<unknown>(incident.diagnosisJson, null),
      changes: changes.map((change) => ({ ...change, detail: parseJson(change.detailJson, {}) })),
      openingRun: {
        ...openingRun,
        console: parseJson<unknown[]>(openingRun.consoleJson, []),
        failedRequests: parseJson<unknown[]>(openingRun.failedRequestsJson, []),
      },
      deliveries,
      timeline: runs,
    };
  }

  async alertSettings(shopId: string) {
    const shop = await this.client.shop.findUniqueOrThrow({
      where: { id: shopId },
      include: {
        channels: { orderBy: { type: "asc" } },
        deliveries: { where: { event: "test" }, orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    return { plan: normalizePlan(shop.plan), channels: shop.channels, deliveries: shop.deliveries };
  }

  async saveChannel(shopId: string, plan: PlanName, channel: ChannelType, destination: string) {
    if (!canUseChannel(plan, channel)) {
      await this.logEntitlement(
        shopId,
        `channel:${channel}`,
        `blocked: ${channel} is not included in ${plan}`,
      );
      throw new Response(`${channel} alerts require a higher plan.`, { status: 403 });
    }
    await this.client.alertChannelConfig.upsert({
      where: { shopId_type_destination: { shopId, type: channel, destination } },
      update: { enabled: true },
      create: { shopId, type: channel, destination },
    });
  }

  async testAlerts(shopId: string, plan: PlanName) {
    const channels = await this.client.alertChannelConfig.findMany({ where: { shopId } });
    const message: AlertMessage = {
      key: `test:${shopId}:${Date.now()}`,
      event: "test",
      subject: "CheckoutWatch test alert",
      bodyText: "Your CheckoutWatch alert pipeline is working.",
    };
    const routes: AlertRoute[] = channels.map((channel) => {
      const type = channel.type as ChannelType;
      const entitled = canUseChannel(plan, type);
      return {
        channel: type,
        destination: channel.destination,
        enabled: channel.enabled && entitled,
        ...(!entitled
          ? { skipReason: `plan ${plan} does not include ${type}` }
          : !channel.enabled
            ? { skipReason: "channel is disabled" }
            : {}),
      };
    });
    for (const route of routes.filter(
      (candidate) => candidate.enabled === false && candidate.skipReason?.startsWith("plan"),
    ))
      await this.logEntitlement(
        shopId,
        `channel:${route.channel}`,
        `test alert skipped: ${route.skipReason}`,
      );
    await new AlertDispatcher(
      new PrismaDeliveryLogStore(this.client, shopId),
      this.adapters,
    ).dispatch(message, routes);
  }

  async settings(shopId: string) {
    return this.client.shop.findUniqueOrThrow({ where: { id: shopId } });
  }

  async updateStorefront(shopId: string, storefrontUrl: string) {
    const parsed = new URL(storefrontUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Response("Invalid storefront URL", { status: 400 });
    await this.client.shop.update({
      where: { id: shopId },
      data: { storefrontUrl: parsed.toString().replace(/\/$/, "") },
    });
  }

  private async logEntitlement(
    shopId: string,
    feature: string,
    reason: string,
    metadata: Record<string, unknown> = {},
    action = "skipped",
  ) {
    await this.client.entitlementLog.create({
      data: { shopId, feature, action, reason, metadataJson: JSON.stringify(metadata) },
    });
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}
