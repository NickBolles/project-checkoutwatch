import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BullMQDriver, MemoryDriver, type JobQueue } from "../src/index.js";

function queueContract(label: string, create: () => JobQueue, enabled = true): void {
  const suite = enabled ? describe : describe.skip;
  suite(`${label} JobQueue contract`, () => {
    let queue: JobQueue;
    afterEach(async () => queue?.close());

    it("processes FIFO", async () => {
      queue = create();
      const seen: number[] = [];
      await queue.process<number>("fifo", async (value) => { seen.push(value); });
      await queue.add("fifo", 1);
      await queue.add("fifo", 2);
      await queue.add("fifo", 3);
      await eventually(() => seen.length === 3);
      expect(seen).toEqual([1, 2, 3]);
    });

    it("honors delay", async () => {
      queue = create();
      const start = Date.now();
      let elapsed = 0;
      await queue.process("delay", async () => { elapsed = Date.now() - start; });
      await queue.add("delay", {}, { delayMs: 40 });
      await eventually(() => elapsed > 0);
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    it("retries with backoff", async () => {
      queue = create();
      const attempts: number[] = [];
      const times: number[] = [];
      await queue.process("retry", async (_payload, context) => {
        attempts.push(context.attempt);
        times.push(Date.now());
        if (context.attempt < 3) throw new Error("retry me");
      });
      await queue.add("retry", {}, { attempts: 3, backoff: { type: "fixed", delayMs: 25 } });
      await eventually(() => attempts.length === 3);
      expect(attempts).toEqual([1, 2, 3]);
      expect((times[2] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(35);
    });

    it("caps concurrency", async () => {
      queue = create();
      let active = 0;
      let maxActive = 0;
      let completed = 0;
      await queue.process("concurrency", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        completed += 1;
      }, { concurrency: 2 });
      await Promise.all([1, 2, 3, 4].map((value) => queue.add("concurrency", value)));
      await eventually(() => completed === 4);
      expect(maxActive).toBe(2);
    });

    it("deduplicates duplicate delivery by job id", async () => {
      queue = create();
      let effects = 0;
      await queue.process("dedupe", async () => { effects += 1; });
      const first = await queue.add("dedupe", { monitorId: "m1" }, { jobId: "m1:100" });
      const second = await queue.add("dedupe", { monitorId: "m1" }, { jobId: "m1:100" });
      expect(second).toBe(first);
      await eventually(() => effects === 1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(effects).toBe(1);
    });
  });
}

queueContract("memory", () => new MemoryDriver());
queueContract("BullMQ", () => new BullMQDriver(process.env.REDIS_URL!, `contract-${randomUUID()}`), Boolean(process.env.REDIS_URL));

async function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was not met before timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
