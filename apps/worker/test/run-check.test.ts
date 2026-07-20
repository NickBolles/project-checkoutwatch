import { describe, expect, it, vi } from "vitest";
import type { CheckRunResult } from "@checkoutwatch/engine";
import { createRunCheckHandler, type RunCheckRepository, type RunnableMonitor } from "../src/jobs/run-check.js";

class FakeRunRepository implements RunCheckRepository {
  runningAt: Date | null = null;
  persisted = 0;
  cleared = 0;
  completedKeys = new Set<string>();
  monitor: RunnableMonitor = { id: "m1", productHandle: "test-product", storefrontUrl: "http://store.test" };
  hasJobRun(key: string) { return Promise.resolve(this.completedKeys.has(key)); }
  acquireRunLock(_id: string, now: Date, staleBefore: Date) {
    if (this.runningAt && this.runningAt >= staleBefore) return Promise.resolve(null);
    this.runningAt = now;
    return Promise.resolve(this.monitor);
  }
  persistRun(_id: string, key: string) { this.persisted += 1; this.completedKeys.add(key); return Promise.resolve(); }
  clearRunLock(_id: string, acquiredAt: Date) {
    if (this.runningAt?.getTime() === acquiredAt.getTime()) this.runningAt = null;
    this.cleared += 1;
    return Promise.resolve();
  }
}

const passed: CheckRunResult = {
  runId: "run1", status: "passed", startedAt: "2026-07-20T00:00:00.000Z", finishedAt: "2026-07-20T00:00:01.000Z",
  durationMs: 1000, steps: [], scriptOrigins: [], console: [], failedRequests: [], robotsTxt: { status: 200 },
};

describe("run-check in-flight and idempotency guard", () => {
  it("skips an active monitor without invoking the engine", async () => {
    const repository = new FakeRunRepository();
    repository.runningAt = new Date("2026-07-20T12:00:00Z");
    const runner = { run: vi.fn().mockResolvedValue(passed) };
    const handler = createRunCheckHandler(repository, runner, { now: () => new Date("2026-07-20T12:01:00Z") });
    expect(await handler({ monitorId: "m1" }, { id: "job1" })).toBe("skipped");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("reclaims a stale lock, persists once, and suppresses redelivery", async () => {
    const repository = new FakeRunRepository();
    repository.runningAt = new Date("2026-07-20T11:00:00Z");
    const runner = { run: vi.fn().mockResolvedValue(passed) };
    const handler = createRunCheckHandler(repository, runner, { now: () => new Date("2026-07-20T12:00:00Z") });
    expect(await handler({ monitorId: "m1" }, { id: "job1" })).toBe("completed");
    expect(await handler({ monitorId: "m1" }, { id: "job1" })).toBe("duplicate");
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(repository.persisted).toBe(1);
    expect(repository.cleared).toBe(1);
  });
});
