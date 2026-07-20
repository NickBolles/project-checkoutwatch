import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { DEFAULT_QUEUE_PREFIX } from "./constants.js";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "./types.js";

export class BullMQDriver implements JobQueue {
  private readonly queues = new Map<string, Queue<unknown>>();
  private readonly workers = new Set<Worker>();
  private readonly prefix: string;
  private readonly connection: ConnectionOptions;
  private readonly cancellableNames: readonly string[];

  constructor(
    redisUrl: string,
    prefix = DEFAULT_QUEUE_PREFIX,
    cancellableNames: readonly string[] = [],
  ) {
    this.connection = { url: redisUrl };
    this.prefix = prefix;
    this.cancellableNames = cancellableNames;
  }

  async add<T>(name: string, payload: T, options: EnqueueOpts = {}): Promise<string> {
    const job = await this.queue(name).add(name, payload, {
      ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
      ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
      ...(options.backoff
        ? { backoff: { type: options.backoff.type, delay: options.backoff.delayMs } }
        : {}),
      ...(options.jobId ? { jobId: options.jobId } : {}),
    });
    return job.id ?? options.jobId ?? "unknown";
  }

  async process<T>(
    name: string,
    handler: JobHandler<T>,
    options: { concurrency?: number } = {},
  ): Promise<ProcessorHandle> {
    const worker = new Worker<T>(
      this.queueName(name),
      async (job) =>
        handler(job.data, { id: job.id ?? "unknown", name, attempt: job.attemptsMade + 1 }),
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: options.concurrency ?? 1,
      },
    );
    await worker.waitUntilReady();
    this.workers.add(worker);
    return {
      close: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.workers.clear();
    this.queues.clear();
  }

  async cancelWhere(predicate: (name: string, payload: unknown) => boolean): Promise<number> {
    let removed = 0;
    const names = new Set([...this.queues.keys(), ...this.cancellableNames]);
    for (const name of names) {
      const queue = this.queue(name);
      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized", "paused"]);
      for (const job of jobs) {
        if (!predicate(name, job.data)) continue;
        await job.remove();
        removed += 1;
      }
    }
    return removed;
  }

  private queue(name: string): Queue<unknown> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<unknown>(this.queueName(name), {
        connection: this.connection,
        prefix: this.prefix,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private queueName(name: string): string {
    return `jobs-${name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
