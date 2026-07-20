import { z } from "zod";

export const stepTimingSchema = z.object({
  step: z.string().min(1),
  ms: z.number().int().nonnegative(),
  httpStatus: z.number().int().min(100).max(599).optional(),
});

export type StepTiming = z.infer<typeof stepTimingSchema>;

export const consoleEntrySchema = z.object({
  level: z.enum(["warn", "error"]),
  text: z.string(),
  timestamp: z.string().datetime().optional(),
});

export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const failedRequestSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().int().optional(),
  error: z.string().optional(),
});

export type FailedRequest = z.infer<typeof failedRequestSchema>;

export function writeJson<T>(value: T): string {
  return JSON.stringify(value);
}

export function readJson<T>(value: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error("Stored JSON column contains invalid JSON", { cause: error });
  }
  return schema.parse(parsed);
}

export function readStepTimings(run: { stepTimingsJson: string }): StepTiming[] {
  return readJson(run.stepTimingsJson, z.array(stepTimingSchema));
}

export function readConsoleEntries(run: { consoleJson: string }): ConsoleEntry[] {
  return readJson(run.consoleJson, z.array(consoleEntrySchema));
}

export function readFailedRequests(run: { failedRequestsJson: string }): FailedRequest[] {
  return readJson(run.failedRequestsJson, z.array(failedRequestSchema));
}

export function readScriptOrigins(run: { scriptOriginsJson: string }): string[] {
  return readJson(run.scriptOriginsJson, z.array(z.string().url()));
}
