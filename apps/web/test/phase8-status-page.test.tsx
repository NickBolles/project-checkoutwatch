import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  availability,
  buildDayBuckets,
  StatusPageService,
} from "../app/services/status-page.server.js";
import { StatusPageView } from "../app/routes/status.$slug.js";
import { isolatedClient } from "./helpers.js";
import { allowStatusRequest } from "../app/services/status-rate-limit.server.js";

const clients: Array<Awaited<ReturnType<typeof isolatedClient>>["client"]> = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.$disconnect())));

describe("Phase 8 public status page", () => {
  it("rate limits abusive public clients without authentication", () => {
    expect(allowStatusRequest("phase9-client", 1_000, 2, 60_000)).toBe(true);
    expect(allowStatusRequest("phase9-client", 1_001, 2, 60_000)).toBe(true);
    expect(allowStatusRequest("phase9-client", 1_002, 2, 60_000)).toBe(false);
    expect(allowStatusRequest("phase9-client", 61_001, 2, 60_000)).toBe(true);
  });
  it("excludes error/skipped runs from uptime and represents partial/no-data days", () => {
    expect(
      availability([
        { status: "passed" },
        { status: "failed" },
        { status: "error" },
        { status: "skipped" },
      ]),
    ).toEqual({
      uptime: 50,
      passed: 1,
      failed: 1,
      excluded: 2,
    });
    const now = new Date("2026-07-20T12:00:00.000Z");
    const buckets = buildDayBuckets(
      [
        { status: "error", startedAt: new Date("2026-07-19T03:00:00.000Z") },
        { status: "passed", startedAt: new Date("2026-07-20T01:00:00.000Z") },
        { status: "failed", startedAt: new Date("2026-07-20T02:00:00.000Z") },
      ],
      now,
      3,
    );
    expect(buckets).toEqual([
      { date: "2026-07-18", state: "no_data", uptime: null },
      { date: "2026-07-19", state: "no_data", uptime: null },
      { date: "2026-07-20", state: "outage", uptime: 50 },
    ]);
  });

  it("returns only entitled enabled pages and never leaks internal incident fields into rendered HTML", async () => {
    const { client } = await isolatedClient("checkoutwatch-status-");
    clients.push(client);
    const shop = await client.shop.create({
      data: {
        shopDomain: "status-pro.test",
        storefrontUrl: "https://secret-store.example/internal",
        accessToken: "encrypted-super-secret-token",
        plan: "pro",
        statusPage: { create: { slug: "safe-shop", title: "Safe Shop", enabled: true } },
        monitors: {
          create: {
            name: "Main checkout",
            productHandle: "private-product-handle",
            productTitle: "Private Product",
            intervalMinutes: 5,
          },
        },
      },
      include: { monitors: true },
    });
    const monitor = shop.monitors[0]!;
    const openingRun = await client.checkRun.create({
      data: {
        monitorId: monitor.id,
        status: "failed",
        startedAt: new Date("2026-07-20T10:00:00.000Z"),
        finishedAt: new Date("2026-07-20T10:00:01.000Z"),
        durationMs: 1000,
        failureCode: "PAYMENT_IFRAME_MISSING",
        failureMessage: "database.internal:5432 token=raw-secret",
        consoleJson: '[{"text":"credit-card iframe private URL"}]',
        failedRequestsJson: '["https://private-provider.example/key"]',
        screenshotPath: "C:/private/artifacts/failure.png",
      },
    });
    await client.incident.create({
      data: {
        monitorId: monitor.id,
        openingRunId: openingRun.id,
        failureCode: "PAYMENT_IFRAME_MISSING",
        diagnosisJson: '{"summary":"raw-secret diagnosis","evidence":["private-provider.example"]}',
        changeContextJson: '[{"app":"private-app"}]',
      },
    });

    const data = await new StatusPageService(client, 0).getPublicPage(
      "safe-shop",
      new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(data).not.toBeNull();
    const router = createMemoryRouter([{ path: "*", element: <StatusPageView data={data!} /> }], {
      initialEntries: ["/status/safe-shop"],
    });
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Safe Shop");
    expect(html).toContain("The payment step was unavailable.");
    expect(html).not.toMatch(
      /raw-secret|database\.internal|private-provider|private-product-handle|encrypted-super-secret|failure\.png|private-app/,
    );
  });

  it("enforces Pro when enabling and hides disabled, downgraded, and unknown slugs", async () => {
    const { client } = await isolatedClient("checkoutwatch-status-gate-");
    clients.push(client);
    const shop = await client.shop.create({
      data: {
        shopDomain: "status-free.test",
        storefrontUrl: "https://status-free.test",
        plan: "free",
      },
    });
    const service = new StatusPageService(client, 0);
    await expect(
      service.saveSettings(shop.id, { slug: "free-shop", title: "Free", enabled: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await client.entitlementLog.findFirst({
        where: { shopId: shop.id, feature: "public_status_page" },
      }),
    ).toMatchObject({ action: "skipped" });
    await service.saveSettings(shop.id, { slug: "free-shop", title: "Free", enabled: false });
    expect(await service.getPublicPage("free-shop")).toBeNull();
    expect(await service.getPublicPage("unknown-shop")).toBeNull();
    await client.shop.update({ where: { id: shop.id }, data: { plan: "pro" } });
    await service.saveSettings(shop.id, { slug: "free-shop", title: "Free", enabled: true });
    expect(await service.getPublicPage("free-shop")).not.toBeNull();
    await client.shop.update({ where: { id: shop.id }, data: { plan: "growth" } });
    expect(await new StatusPageService(client, 0).getPublicPage("free-shop")).toBeNull();
  });
});
