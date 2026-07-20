export * from "./types.js";
export * from "./memory-driver.js";
export * from "./bullmq-driver.js";

import { BullMQDriver } from "./bullmq-driver.js";
import { MemoryDriver } from "./memory-driver.js";
import type { JobQueue } from "./types.js";

export function createJobQueue(config: {
  queueDriver: "memory" | "bullmq";
  redisUrl?: string;
}): JobQueue {
  if (config.queueDriver === "memory") return new MemoryDriver();
  if (!config.redisUrl) throw new Error("REDIS_URL is required for BullMQ");
  return new BullMQDriver(config.redisUrl, `checkoutwatch-${process.pid}`, [
    "run-check",
    "recheck",
    "dispatch-alert",
    "diagnose-incident",
    "poll-store-changes",
    "reconcile-plan",
  ]);
}
