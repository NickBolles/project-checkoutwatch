import { randomUUID } from "node:crypto";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "./types.js";

interface MemoryJob {
  id: string;
  name: string;
  payload: unknown;
  options: EnqueueOpts;
  attempt: number;
  availableAt: number;
  sequence: number;
}

interface Processor {
  handler: JobHandler;
  concurrency: number;
  active: number;
  closed: boolean;
}

export class MemoryDriver implements JobQueue {
  private readonly jobs: MemoryJob[] = [];
  private readonly processors = new Map<string, Processor>();
  private readonly knownIds = new Map<string, string>();
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  add<T>(name: string, payload: T, options: EnqueueOpts = {}): Promise<string> {
    if (this.closed) return Promise.reject(new Error("queue is closed"));
    const dedupeKey = options.jobId ? `${name}:${options.jobId}` : undefined;
    const existing = dedupeKey ? this.knownIds.get(dedupeKey) : undefined;
    if (existing) return Promise.resolve(existing);
    const id = options.jobId ?? randomUUID();
    if (dedupeKey) this.knownIds.set(dedupeKey, id);
    this.jobs.push({
      id,
      name,
      payload,
      options,
      attempt: 0,
      availableAt: Date.now() + (options.delayMs ?? 0),
      sequence: this.sequence++,
    });
    this.schedule();
    return Promise.resolve(id);
  }

  process<T>(
    name: string,
    handler: JobHandler<T>,
    options: { concurrency?: number } = {},
  ): Promise<ProcessorHandle> {
    if (this.processors.has(name))
      return Promise.reject(new Error(`processor already registered for ${name}`));
    const processor: Processor = {
      handler: handler as JobHandler,
      concurrency: options.concurrency ?? 1,
      active: 0,
      closed: false,
    };
    this.processors.set(name, processor);
    this.schedule();
    return Promise.resolve({
      close: async () => {
        processor.closed = true;
        this.processors.delete(name);
        await this.waitForIdle(processor);
      },
    });
  }

  cancelWhere(predicate: (name: string, payload: unknown) => boolean): Promise<number> {
    let removed = 0;
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      const job = this.jobs[index];
      if (job && predicate(job.name, job.payload)) {
        this.jobs.splice(index, 1);
        if (job.options.jobId) this.knownIds.delete(`${job.name}:${job.options.jobId}`);
        removed += 1;
      }
    }
    this.schedule();
    return Promise.resolve(removed);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const processors = [...this.processors.values()];
    for (const processor of processors) processor.closed = true;
    await Promise.all(processors.map((processor) => this.waitForIdle(processor)));
    this.processors.clear();
  }

  private schedule(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pump(), 0);
  }

  private pump(): void {
    this.timer = undefined;
    if (this.closed) return;
    const now = Date.now();
    for (const [name, processor] of this.processors) {
      while (!processor.closed && processor.active < processor.concurrency) {
        const index = this.jobs
          .map((job, jobIndex) => ({ job, jobIndex }))
          .filter(({ job }) => job.name === name && job.availableAt <= now)
          .sort((left, right) => left.job.sequence - right.job.sequence)[0]?.jobIndex;
        if (index === undefined) break;
        const [job] = this.jobs.splice(index, 1);
        if (!job) break;
        processor.active += 1;
        void this.execute(job, processor);
      }
    }
    const schedulable = this.jobs.filter((job) => {
      const processor = this.processors.get(job.name);
      return processor && !processor.closed && processor.active < processor.concurrency;
    });
    const next = schedulable.reduce<number | undefined>(
      (minimum, job) =>
        minimum === undefined ? job.availableAt : Math.min(minimum, job.availableAt),
      undefined,
    );
    if (next !== undefined)
      this.timer = setTimeout(() => this.pump(), Math.max(0, next - Date.now()));
  }

  private async execute(job: MemoryJob, processor: Processor): Promise<void> {
    job.attempt += 1;
    try {
      await processor.handler(job.payload, { id: job.id, name: job.name, attempt: job.attempt });
    } catch {
      if (job.attempt < (job.options.attempts ?? 1) && !this.closed) {
        const backoff = job.options.backoff;
        const delay = backoff
          ? backoff.delayMs * (backoff.type === "exponential" ? 2 ** (job.attempt - 1) : 1)
          : 0;
        job.availableAt = Date.now() + delay;
        job.sequence = this.sequence++;
        this.jobs.push(job);
      }
    } finally {
      processor.active -= 1;
      this.schedule();
    }
  }

  private async waitForIdle(processor: Processor): Promise<void> {
    while (processor.active > 0) await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
