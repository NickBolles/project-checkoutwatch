import type { CheckoutRunner } from "@checkoutwatch/engine";
import type { JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import { createRunCheckHandler, type RunCheckPayload, type RunCheckRepository } from "./run-check.js";

export async function registerJobs(queue: JobQueue, repository: RunCheckRepository, runner: Pick<CheckoutRunner, "run">, concurrency: number): Promise<ProcessorHandle[]> {
  const runCheck = createRunCheckHandler(repository, runner);
  const handles = [
    await queue.process<RunCheckPayload>("run-check", async (payload, context) => { await runCheck(payload, context); }, { concurrency }),
  ];
  for (const name of ["recheck", "dispatch-alert", "poll-store-changes"]) {
    handles.push(await queue.process(name, async () => { /* Phase 5/4 processor stub. */ }));
  }
  return handles;
}
