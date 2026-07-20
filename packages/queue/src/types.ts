export interface EnqueueOpts {
  delayMs?: number;
  attempts?: number;
  backoff?: { type: "fixed" | "exponential"; delayMs: number };
  jobId?: string;
}

export interface JobContext {
  id: string;
  name: string;
  attempt: number;
}

export type JobHandler<T = unknown> = (payload: T, context: JobContext) => Promise<void>;

export interface ProcessorHandle { close(): Promise<void> }

export interface JobQueue {
  add<T>(name: string, payload: T, options?: EnqueueOpts): Promise<string>;
  process<T>(name: string, handler: JobHandler<T>, options?: { concurrency?: number }): Promise<ProcessorHandle>;
  close(): Promise<void>;
}
