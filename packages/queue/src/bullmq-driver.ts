import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "./types.js";

export class BullMQDriver implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();
  private readonly prefix: string;
  private readonly connection: ConnectionOptions;

  constructor(redisUrl: string, prefix = `checkoutwatch-${process.pid}`) {
    this.connection = { url: redisUrl };
    this.prefix = prefix;
  }

  async add<T>(name: string, payload: T, options: EnqueueOpts = {}): Promise<string> {
    const job = await this.queue(name).add(name, payload, {
      ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
      ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
      ...(options.backoff ? { backoff: { type: options.backoff.type, delay: options.backoff.delayMs } } : {}),
      ...(options.jobId ? { jobId: options.jobId } : {}),
    });
    return job.id ?? options.jobId ?? "unknown";
  }

  async process<T>(name: string, handler: JobHandler<T>, options: { concurrency?: number } = {}): Promise<ProcessorHandle> {
    const worker = new Worker<T>(this.queueName(name), async (job) => handler(job.data, { id: job.id ?? "unknown", name, attempt: job.attemptsMade + 1 }), {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: options.concurrency ?? 1,
    });
    await worker.waitUntilReady();
    this.workers.add(worker);
    return { close: async () => { this.workers.delete(worker); await worker.close(); } };
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.workers.clear();
    this.queues.clear();
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(this.queueName(name), { connection: this.connection, prefix: this.prefix });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private queueName(name: string): string { return `jobs-${name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`; }
}
