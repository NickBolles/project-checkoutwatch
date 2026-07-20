import type { PrismaClient } from "@prisma/client";
import { logger, type PlanName } from "@checkoutwatch/core";
import { readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const DAY_MS = 86_400_000;
export const RETENTION_DAYS: Record<PlanName, number> = { free: 7, growth: 30, pro: 90 };

export interface RetentionResult {
  deletedRuns: number;
  deletedArtifactDirectories: number;
  retainedIncidentRuns: number;
}

export function createRetentionHandler(client: PrismaClient, artifactRoot: string) {
  return async (_payload: unknown = {}, now = new Date()): Promise<RetentionResult> => {
    const protectedIds = new Set<string>();
    for (const incident of await client.incident.findMany({
      select: { openingRunId: true, resolvingRunId: true },
    })) {
      protectedIds.add(incident.openingRunId);
      if (incident.resolvingRunId) protectedIds.add(incident.resolvingRunId);
    }
    const monitors = await client.monitor.findMany({
      include: { shop: { select: { plan: true } } },
    });
    const deleteIds: string[] = [];
    for (const monitor of monitors) {
      const cutoff = new Date(
        now.getTime() - RETENTION_DAYS[normalizePlan(monitor.shop.plan)] * DAY_MS,
      );
      const expired = await client.checkRun.findMany({
        where: { monitorId: monitor.id, startedAt: { lt: cutoff } },
        select: { id: true },
      });
      deleteIds.push(...expired.map((run) => run.id).filter((id) => !protectedIds.has(id)));
    }
    if (deleteIds.length) await client.checkRun.deleteMany({ where: { id: { in: deleteIds } } });
    const liveArtifactIds = new Set(
      (
        await client.checkRun.findMany({
          where: { screenshotPath: { not: null } },
          select: { id: true },
        })
      ).map((run) => run.id),
    );
    const deletedArtifactDirectories = await sweepOrphanArtifacts(artifactRoot, liveArtifactIds);
    const result = {
      deletedRuns: deleteIds.length,
      deletedArtifactDirectories,
      retainedIncidentRuns: protectedIds.size,
    };
    logger.info({ job: "retention", ...result }, "retention sweep completed");
    return result;
  };
}

export async function sweepOrphanArtifacts(root: string, liveRunIds: ReadonlySet<string>) {
  const absoluteRoot = resolve(root);
  if (!isAbsolute(absoluteRoot)) throw new Error("Artifact root must resolve to an absolute path");
  let entries;
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || liveRunIds.has(entry.name)) continue;
    const target = resolve(absoluteRoot, entry.name);
    const inside = relative(absoluteRoot, target);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) continue;
    await rm(target, { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
