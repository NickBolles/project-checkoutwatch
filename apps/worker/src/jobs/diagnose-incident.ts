import type { PrismaClient } from "@prisma/client";
import { logger } from "@checkoutwatch/core";
import { PrismaIncidentRepository } from "@checkoutwatch/db";
import { diagnoseRun, type DiagnoseRunOptions } from "../diagnose-run.js";

export interface DiagnoseIncidentPayload {
  incidentId: string;
  runId: string;
}

export function createDiagnoseIncidentHandler(
  client: PrismaClient,
  options: DiagnoseRunOptions & { timeoutMs?: number } = {},
) {
  const repository = new PrismaIncidentRepository(client);
  return async (payload: DiagnoseIncidentPayload): Promise<void> => {
    try {
      const diagnosis = await withTimeout(
        diagnoseRun(client, payload.runId, options),
        options.timeoutMs ?? 10_000,
      );
      await repository.updateDiagnosis(payload.incidentId, diagnosis);
    } catch (error) {
      logger.warn(
        {
          incidentId: payload.incidentId,
          error: error instanceof Error ? error.message : String(error),
        },
        "LLM diagnosis failed; retained heuristic diagnosis",
      );
    }
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Diagnosis timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
