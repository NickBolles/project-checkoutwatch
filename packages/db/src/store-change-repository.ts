import type { PrismaClient } from "@prisma/client";
import type { MainTheme } from "@checkoutwatch/shopify";
import { writeJson } from "./json.js";

export interface ChangePollShop {
  id: string;
  shopDomain: string;
}

export interface ScriptOriginDiff {
  added: string[];
  removed: string[];
}

export function diffScriptOrigins(
  previous: readonly string[],
  current: readonly string[],
): ScriptOriginDiff {
  const before = new Set(previous);
  const after = new Set(current);
  return {
    added: [...after].filter((origin) => !before.has(origin)).sort(),
    removed: [...before].filter((origin) => !after.has(origin)).sort(),
  };
}

export class PrismaStoreChangeRepository {
  constructor(private readonly client: PrismaClient) {}

  async shopsForPolling(): Promise<ChangePollShop[]> {
    return this.client.shop.findMany({
      where: { uninstalledAt: null, monitors: { some: { enabled: true } } },
      select: { id: true, shopDomain: true },
    });
  }

  async recordThemeObservation(
    shopId: string,
    theme: MainTheme,
    detectedAt = new Date(),
  ): Promise<boolean> {
    const latest = await this.client.storeChangeEvent.findFirst({
      where: { shopId, kind: { in: ["theme_snapshot", "theme_updated"] } },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    });
    const detail = parseRecord(latest?.detailJson);
    const observed = latest?.kind === "theme_updated" ? asRecord(detail.current) : detail;
    if (!latest) {
      await this.client.storeChangeEvent.create({
        data: { shopId, detectedAt, kind: "theme_snapshot", detailJson: writeJson(theme) },
      });
      return false;
    }
    if (observed.id === theme.id && observed.updatedAt === theme.updatedAt) return false;
    await this.client.storeChangeEvent.create({
      data: {
        shopId,
        detectedAt,
        kind: "theme_updated",
        detailJson: writeJson({ previous: observed, current: theme }),
      },
    });
    return true;
  }

  async recordScriptOriginDiff(runId: string, detectedAt = new Date()): Promise<ScriptOriginDiff> {
    const run = await this.client.checkRun.findUnique({
      where: { id: runId },
      include: { monitor: { select: { shopId: true } } },
    });
    if (!run) throw new Error(`CheckRun ${runId} was not found`);
    const previous = await this.client.checkRun.findFirst({
      where: {
        monitorId: run.monitorId,
        status: "passed",
        startedAt: { lt: run.startedAt },
        id: { not: run.id },
      },
      orderBy: { startedAt: "desc" },
      select: { scriptOriginsJson: true },
    });
    if (!previous) return { added: [], removed: [] };
    const diff = diffScriptOrigins(
      parseStringArray(previous.scriptOriginsJson),
      parseStringArray(run.scriptOriginsJson),
    );
    const events = [
      ...diff.added.map((origin) => ({ kind: "script_added", origin })),
      ...diff.removed.map((origin) => ({ kind: "script_removed", origin })),
    ];
    await this.client.$transaction(
      events.map((event) =>
        this.client.storeChangeEvent.create({
          data: {
            shopId: run.monitor.shopId,
            detectedAt,
            kind: event.kind,
            detailJson: writeJson({ origin: event.origin, runId }),
          },
        }),
      ),
    );
    return diff;
  }
}

function parseRecord(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
