import { describe, expect, it } from "vitest";
import { MemoryDriver } from "@checkoutwatch/queue";
import {
  MonitorScheduler,
  type SchedulableMonitor,
  type SchedulerRepository,
} from "../src/scheduler.js";

class FakeSchedulerRepository implements SchedulerRepository {
  claimed = new Set<string>();
  advances: Date[] = [];
  constructor(readonly monitors: SchedulableMonitor[]) {}
  dueMonitors(now: Date) {
    return Promise.resolve(this.monitors.filter((monitor) => monitor.nextRunAt <= now));
  }
  claimSchedule(id: string, seen: Date, next: Date) {
    const key = `${id}:${seen.getTime()}`;
    if (this.claimed.has(key)) return Promise.resolve(false);
    this.claimed.add(key);
    this.advances.push(next);
    return Promise.resolve(true);
  }
}

describe("MonitorScheduler", () => {
  it("selects only due monitors", async () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const repository = new FakeSchedulerRepository([
      { id: "due", nextRunAt: new Date(now.getTime() - 1), intervalMinutes: 60, plan: "free" },
      { id: "future", nextRunAt: new Date(now.getTime() + 1), intervalMinutes: 60, plan: "free" },
    ]);
    const queue = new MemoryDriver();
    expect(await new MonitorScheduler(repository, queue).tick(now)).toBe(1);
    expect(repository.claimed.size).toBe(1);
    await queue.close();
  });

  it("clamps intervals by plan", async () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const repository = new FakeSchedulerRepository([
      { id: "m", nextRunAt: now, intervalMinutes: 1, plan: "growth" },
    ]);
    const queue = new MemoryDriver();
    await new MonitorScheduler(repository, queue).tick(now);
    expect(repository.advances[0]?.getTime()).toBe(now.getTime() + 10 * 60_000);
    await queue.close();
  });

  it("two concurrent ticks atomically claim and enqueue once", async () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const repository = new FakeSchedulerRepository([
      { id: "m", nextRunAt: now, intervalMinutes: 60, plan: "free" },
    ]);
    const queue = new MemoryDriver();
    let received = 0;
    await queue.process("run-check", async () => {
      received += 1;
    });
    const scheduler = new MonitorScheduler(repository, queue);
    expect(await Promise.all([scheduler.tick(now), scheduler.tick(now)])).toEqual(
      expect.arrayContaining([0, 1]),
    );
    await eventually(() => received === 1);
    expect(received).toBe(1);
    await queue.close();
  });
});

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
