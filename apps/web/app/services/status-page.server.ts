import { PLAN_ENTITLEMENTS, type PlanName } from "@checkoutwatch/core";
import type { PrismaClient } from "@prisma/client";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;

export type PublicDayState = "operational" | "outage" | "no_data";

export interface PublicStatusPageData {
  slug: string;
  title: string;
  state: "operational" | "incident";
  monitors: Array<{
    name: string;
    uptime: number | null;
    days: Array<{ date: string; state: PublicDayState; uptime: number | null }>;
    responseTimes: Array<{ at: string; durationMs: number }>;
  }>;
  incidents: Array<{
    status: "open" | "resolved";
    monitorName: string;
    openedAt: string;
    resolvedAt: string | null;
    durationMinutes: number | null;
    summary: string;
  }>;
}

export interface AvailabilitySummary {
  uptime: number | null;
  passed: number;
  failed: number;
  excluded: number;
}

export function availability(runs: readonly { status: string }[]): AvailabilitySummary {
  const passed = runs.filter((run) => run.status === "passed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const measured = passed + failed;
  return {
    uptime: measured === 0 ? null : (passed / measured) * 100,
    passed,
    failed,
    excluded: runs.length - measured,
  };
}

export function buildDayBuckets(
  runs: readonly { status: string; startedAt: Date }[],
  now = new Date(),
  days = DEFAULT_WINDOW_DAYS,
) {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const start = todayStart - (days - index - 1) * DAY_MS;
    const end = start + DAY_MS;
    const bucket = runs.filter((run) => {
      const time = run.startedAt.getTime();
      return time >= start && time < end;
    });
    const summary = availability(bucket);
    return {
      date: new Date(start).toISOString().slice(0, 10),
      state:
        summary.uptime === null
          ? ("no_data" as const)
          : summary.failed > 0
            ? ("outage" as const)
            : ("operational" as const),
      uptime: summary.uptime,
    };
  });
}

const PUBLIC_INCIDENT_COPY: Record<string, string> = {
  ADD_TO_CART_NOT_FOUND: "Adding this product to the cart was unavailable.",
  CART_EMPTY: "The cart step was unavailable.",
  CHECKOUT_HTTP_5XX: "The checkout returned an unavailable response.",
  CHECKOUT_NOT_REACHED: "The checkout page could not be reached.",
  PAYMENT_IFRAME_MISSING: "The payment step was unavailable.",
  PAYMENT_STEP_MISSING: "The payment step was unavailable.",
  PRODUCT_UNAVAILABLE: "The monitored product was unavailable.",
  STORE_UNREACHABLE: "The storefront could not be reached.",
  TIMEOUT_ADD_TO_CART: "The cart step did not respond in time.",
  TIMEOUT_CHECKOUT: "The checkout did not respond in time.",
  TIMEOUT_PRODUCT: "The storefront did not respond in time.",
};

export function publicIncidentSummary(failureCode: string): string {
  return PUBLIC_INCIDENT_COPY[failureCode] ?? "A checkout availability issue was detected.";
}

interface CacheEntry {
  expiresAt: number;
  data: PublicStatusPageData;
}

export class StatusPageService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly client: PrismaClient,
    private readonly cacheTtlMs = 60_000,
  ) {}

  async getPublicPage(slug: string, now = new Date()): Promise<PublicStatusPageData | null> {
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > now.getTime()) {
      const gate = await this.client.statusPage.findUnique({
        where: { slug },
        select: {
          enabled: true,
          shop: { select: { plan: true, uninstalledAt: true } },
        },
      });
      if (
        gate?.enabled &&
        gate.shop.uninstalledAt === null &&
        PLAN_ENTITLEMENTS[normalizePlan(gate.shop.plan)].publicStatusPage
      )
        return cached.data;
      this.cache.delete(slug);
      return null;
    }

    const page = await this.client.statusPage.findUnique({
      where: { slug },
      include: {
        shop: {
          include: {
            monitors: {
              where: { enabled: true },
              orderBy: { name: "asc" },
              include: {
                runs: {
                  where: {
                    startedAt: { gte: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS) },
                  },
                  orderBy: { startedAt: "asc" },
                },
                incidents: { orderBy: { openedAt: "desc" }, take: 20 },
              },
            },
          },
        },
      },
    });
    if (
      !page?.enabled ||
      page.shop.uninstalledAt !== null ||
      !PLAN_ENTITLEMENTS[normalizePlan(page.shop.plan)].publicStatusPage
    )
      return null;

    const incidents = page.shop.monitors
      .flatMap((monitor) =>
        monitor.incidents.map((incident) => ({
          status: incident.status === "open" ? ("open" as const) : ("resolved" as const),
          monitorName: monitor.name,
          openedAt: incident.openedAt.toISOString(),
          resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          durationMinutes: incident.resolvedAt
            ? Math.max(
                0,
                Math.round((incident.resolvedAt.getTime() - incident.openedAt.getTime()) / 60_000),
              )
            : null,
          summary: publicIncidentSummary(incident.failureCode),
        })),
      )
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .slice(0, 20);
    const data: PublicStatusPageData = {
      slug: page.slug,
      title: page.title,
      state: incidents.some((incident) => incident.status === "open") ? "incident" : "operational",
      monitors: page.shop.monitors.map((monitor) => ({
        name: monitor.name,
        uptime: availability(monitor.runs).uptime,
        days: buildDayBuckets(monitor.runs, now),
        responseTimes: monitor.runs
          .filter(
            (run): run is typeof run & { durationMs: number } =>
              (run.status === "passed" || run.status === "failed") && run.durationMs !== null,
          )
          .slice(-30)
          .map((run) => ({ at: run.startedAt.toISOString(), durationMs: run.durationMs })),
      })),
      incidents,
    };
    this.cache.set(slug, { data, expiresAt: now.getTime() + this.cacheTtlMs });
    return data;
  }

  async settings(shopId: string) {
    const shop = await this.client.shop.findUniqueOrThrow({
      where: { id: shopId },
      include: { statusPage: true },
    });
    const plan = normalizePlan(shop.plan);
    return { plan, entitled: PLAN_ENTITLEMENTS[plan].publicStatusPage, page: shop.statusPage };
  }

  async saveSettings(shopId: string, input: { slug: string; title: string; enabled: boolean }) {
    const shop = await this.client.shop.findUniqueOrThrow({ where: { id: shopId } });
    const plan = normalizePlan(shop.plan);
    if (input.enabled && !PLAN_ENTITLEMENTS[plan].publicStatusPage) {
      await this.client.entitlementLog.create({
        data: {
          shopId,
          feature: "public_status_page",
          action: "skipped",
          reason: `blocked: public status pages require Pro (current plan: ${plan})`,
        },
      });
      throw new Response("Public status pages require the Pro plan.", { status: 403 });
    }
    const slug = input.slug.trim().toLowerCase();
    const title = input.title.trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug))
      throw new Response("Slug must be 3-63 lowercase letters, numbers, or hyphens.", {
        status: 400,
      });
    if (title.length < 1 || title.length > 100)
      throw new Response("Title must be 1-100 characters.", { status: 400 });
    try {
      const saved = await this.client.statusPage.upsert({
        where: { shopId },
        update: { slug, title, enabled: input.enabled },
        create: { shopId, slug, title, enabled: input.enabled },
      });
      this.cache.delete(slug);
      return saved;
    } catch (error) {
      if (isUniqueConstraint(error))
        throw new Response("That status-page slug is unavailable.", { status: 409 });
      throw error;
    }
  }
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const services = new WeakMap<PrismaClient, StatusPageService>();

export function statusPageService(client: PrismaClient): StatusPageService {
  const existing = services.get(client);
  if (existing) return existing;
  const service = new StatusPageService(client);
  services.set(client, service);
  return service;
}
