import type { PrismaClient } from "@prisma/client";
import { logger } from "@checkoutwatch/core";
import { PrismaIncidentRepository } from "@checkoutwatch/db";
import type { JobQueue } from "@checkoutwatch/queue";
import { diagnoseRun, type DiagnoseRunOptions } from "./diagnose-run.js";
import { transitionIncident, type IncidentAction } from "./incident-machine.js";

export interface IncidentServiceOptions {
  now?: () => Date;
  recheckDelayMs?: number;
  reopenCooldownMs?: number;
  productUnavailableAutopause?: number;
  changeLookbackMs?: number;
  diagnosis?: DiagnoseRunOptions;
  opsFlag?: (detail: { monitorId: string; runId: string; consecutiveErrors: number }) => void;
}

export class IncidentService {
  private readonly repository: PrismaIncidentRepository;
  private readonly now: () => Date;

  constructor(
    private readonly client: PrismaClient,
    private readonly queue: JobQueue,
    private readonly options: IncidentServiceOptions = {},
  ) {
    this.repository = new PrismaIncidentRepository(client);
    this.now = options.now ?? (() => new Date());
  }

  async processRunResult(runId: string): Promise<void> {
    const run = await this.repository.loadRunState(runId);
    const transition = transitionIncident(
      {
        consecutiveFails: run.monitor.consecutiveFails,
        consecutiveErrors: run.monitor.consecutiveErrors,
        consecutiveProductUnavailable: run.consecutiveProductUnavailable,
        ...(run.monitor.openIncidentId ? { openIncidentId: run.monitor.openIncidentId } : {}),
        ...(run.recentlyResolved ? { recentlyResolved: run.recentlyResolved } : {}),
        enabled: run.monitor.enabled,
      },
      { status: run.status, ...(run.failureCode ? { failureCode: run.failureCode } : {}) },
      {
        now: this.now(),
        ...(this.options.recheckDelayMs === undefined
          ? {}
          : { recheckDelayMs: this.options.recheckDelayMs }),
        ...(this.options.reopenCooldownMs === undefined
          ? {}
          : { reopenCooldownMs: this.options.reopenCooldownMs }),
        ...(this.options.productUnavailableAutopause === undefined
          ? {}
          : { productUnavailableAutopause: this.options.productUnavailableAutopause }),
      },
    );
    await this.repository.updateMonitorState(run.monitorId, {
      consecutiveFails: transition.state.consecutiveFails,
      consecutiveErrors: transition.state.consecutiveErrors,
      enabled: transition.state.enabled,
    });
    for (const action of transition.actions) await this.applyAction(action, run);
  }

  private async applyAction(
    action: IncidentAction,
    run: { id: string; monitorId: string; failureCode?: string },
  ): Promise<void> {
    if (action.type === "scheduleRecheck") {
      await this.queue.add(
        "recheck",
        { monitorId: run.monitorId, trigger: "recheck" },
        { delayMs: action.delayMs, jobId: `recheck:${run.id}` },
      );
      return;
    }
    if (action.type === "opsFlag") {
      const detail = {
        monitorId: run.monitorId,
        runId: run.id,
        consecutiveErrors: action.consecutiveErrors,
      };
      (
        this.options.opsFlag ??
        ((value) => logger.error(value, "Consecutive checkout runner errors"))
      )(detail);
      return;
    }
    if (action.type === "flagMonitorAttention") {
      await this.queue.add(
        "dispatch-alert",
        {
          event: "monitor_attention",
          monitorId: run.monitorId,
          runId: run.id,
          autoPaused: action.autoPause,
        },
        { jobId: `attention:${run.id}:${action.autoPause ? "paused" : "unavailable"}` },
      );
      return;
    }
    if (action.type === "resolveIncident") {
      if (
        await this.repository.resolveIncident(action.incidentId, run.monitorId, run.id, this.now())
      ) {
        await this.queue.add(
          "dispatch-alert",
          { event: "incident_resolved", incidentId: action.incidentId },
          { jobId: `alert:${action.incidentId}:resolved` },
        );
      }
      return;
    }
    if (!run.failureCode) throw new Error(`Failed run ${run.id} has no failureCode`);
    if (action.type === "reopenIncident") {
      await this.repository.reopenIncident(
        action.incidentId,
        run.monitorId,
        run.id,
        run.failureCode,
      );
      await this.queue.add(
        "diagnose-incident",
        { incidentId: action.incidentId, runId: run.id },
        { jobId: `diagnose:${action.incidentId}:reopen` },
      );
      return;
    }
    const diagnosis = await diagnoseRun(this.client, run.id, {
      ...this.options.diagnosis,
      allowLlm: false,
    });
    const shop = await this.repository.monitorShop(run.monitorId);
    const changes = await this.repository.recentChanges(
      shop.shopId,
      new Date(this.now().getTime() - (this.options.changeLookbackMs ?? 24 * 60 * 60_000)),
    );
    const incidentId = await this.repository.openIncident({
      monitorId: run.monitorId,
      runId: run.id,
      failureCode: run.failureCode,
      diagnosis,
      changes,
      openedAt: this.now(),
    });
    await this.queue.add(
      "dispatch-alert",
      { event: "incident_opened", incidentId },
      { jobId: `alert:${incidentId}:opened` },
    );
    await this.queue.add(
      "diagnose-incident",
      { incidentId, runId: run.id },
      { jobId: `diagnose:${incidentId}` },
    );
  }
}
