import { clampInterval, type PlanName } from "@checkoutwatch/core";
import type { JobQueue } from "@checkoutwatch/queue";

export interface SchedulableMonitor {
  id: string;
  nextRunAt: Date;
  intervalMinutes: number;
  plan: PlanName;
}

export interface SchedulerRepository {
  dueMonitors(now: Date, limit: number): Promise<SchedulableMonitor[]>;
  claimSchedule(id: string, seenNextRunAt: Date, nextRunAt: Date): Promise<boolean>;
}

export class MonitorScheduler {
  constructor(private readonly repository: SchedulerRepository, private readonly queue: JobQueue, private readonly batchSize = 100) {}

  async tick(now = new Date()): Promise<number> {
    const due = await this.repository.dueMonitors(now, this.batchSize);
    let enqueued = 0;
    await Promise.all(due.map(async (monitor) => {
      const interval = clampInterval(monitor.plan, monitor.intervalMinutes);
      const nextRunAt = new Date(now.getTime() + interval * 60_000);
      if (!await this.repository.claimSchedule(monitor.id, monitor.nextRunAt, nextRunAt)) return;
      await this.queue.add("run-check", { monitorId: monitor.id, scheduledFor: monitor.nextRunAt.toISOString() }, {
        jobId: `${monitor.id}:${monitor.nextRunAt.getTime()}`, attempts: 3,
        backoff: { type: "exponential", delayMs: 1000 },
      });
      enqueued += 1;
    }));
    return enqueued;
  }
}

export function startScheduler(scheduler: MonitorScheduler, intervalMs = 30_000): { close(): void } {
  const timer = setInterval(() => { void scheduler.tick(); }, intervalMs);
  return { close: () => clearInterval(timer) };
}
