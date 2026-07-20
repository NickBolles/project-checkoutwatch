import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, PrismaStoreChangeRepository } from "@checkoutwatch/db";
import { MockShopifyAdmin } from "@checkoutwatch/shopify";
import { diagnoseRun } from "../src/diagnose-run.js";
import { FailureContextBuilder } from "../src/failure-context.js";
import { createPollStoreChangesHandler } from "../src/jobs/poll-store-changes.js";

const clients: Array<ReturnType<typeof createPrismaClient>> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("Phase 4 failure intelligence", () => {
  it("builds FailureContext from seeded run artifacts and cites a preceding script change", async () => {
    const client = await isolatedClient();
    const shop = await client.shop.create({
      data: {
        shopDomain: `phase4-${Date.now()}.test`,
        storefrontUrl: "https://shop.example.test",
        plan: "free",
      },
    });
    const monitor = await client.monitor.create({
      data: { shopId: shop.id, name: "Checkout", productHandle: "widget", productTitle: "Widget" },
    });
    await client.checkRun.create({
      data: {
        id: "passing-run",
        monitorId: monitor.id,
        status: "passed",
        startedAt: new Date("2026-07-20T10:00:00Z"),
        finishedAt: new Date("2026-07-20T10:00:01Z"),
        scriptOriginsJson: JSON.stringify(["https://theme.test"]),
      },
    });
    await client.checkRun.create({
      data: {
        id: "script-run",
        monitorId: monitor.id,
        status: "passed",
        startedAt: new Date("2026-07-20T10:05:00Z"),
        finishedAt: new Date("2026-07-20T10:05:01Z"),
        scriptOriginsJson: JSON.stringify(["https://theme.test", "https://new-app.test"]),
      },
    });
    const changes = new PrismaStoreChangeRepository(client);
    expect(
      await changes.recordScriptOriginDiff("script-run", new Date("2026-07-20T10:05:01Z")),
    ).toEqual({ added: ["https://new-app.test"], removed: [] });
    await client.checkRun.create({
      data: {
        id: "failed-run",
        monitorId: monitor.id,
        status: "failed",
        startedAt: new Date("2026-07-20T10:06:00Z"),
        finishedAt: new Date("2026-07-20T10:06:01Z"),
        failureCode: "PAYMENT_IFRAME_MISSING",
        failureStep: "assert_payment_step",
        failureMessage: "iframe absent",
        consoleJson: JSON.stringify([{ level: "error", text: "payment failed" }]),
        failedRequestsJson: JSON.stringify([
          { method: "GET", url: "https://pay.test/card.js", status: 503 },
        ]),
        scriptOriginsJson: JSON.stringify(["https://theme.test", "https://new-app.test"]),
        stepTimingsJson: JSON.stringify([{ step: "assert_payment_step", ms: 400 }]),
      },
    });
    const context = await new FailureContextBuilder(client).build("failed-run");
    expect(context).toMatchObject({
      failureCode: "PAYMENT_IFRAME_MISSING",
      consoleErrors: [{ text: "payment failed" }],
      failedRequests: [{ status: 503 }],
      stepTimings: [{ ms: 400 }],
    });
    expect(context.recentChanges).toContainEqual(
      expect.objectContaining({
        kind: "script_added",
        detail: { origin: "https://new-app.test", runId: "script-run" },
      }),
    );
    const diagnosis = await diagnoseRun(client, "failed-run", { provider: "anthropic" });
    expect(diagnosis.provider).toBe("heuristic");
    expect(diagnosis.probableCause).toContain("https://new-app.test");
    expect(
      await client.entitlementLog.findFirst({
        where: { shopId: shop.id, feature: "ai_diagnosis" },
      }),
    ).toMatchObject({ action: "skipped", reason: expect.stringContaining("plan free") });
  });

  it("emits theme_updated only after the mock theme timestamp changes", async () => {
    const client = await isolatedClient();
    const shop = await client.shop.create({
      data: { shopDomain: `theme-${Date.now()}.test`, storefrontUrl: "https://shop.example.test" },
    });
    await client.monitor.create({
      data: { shopId: shop.id, name: "Checkout", productHandle: "widget", productTitle: "Widget" },
    });
    const repository = new PrismaStoreChangeRepository(client);
    const admin = new MockShopifyAdmin();
    const poll = createPollStoreChangesHandler(
      repository,
      { forShop: () => admin },
      () => new Date("2026-07-20T12:00:00Z"),
    );
    expect(await poll()).toBe(0);
    admin.setMainTheme(shop.shopDomain, {
      id: "theme-1",
      name: "Fixture main",
      updatedAt: "2026-07-20T11:59:00Z",
    });
    expect(await poll()).toBe(1);
    expect(await poll()).toBe(0);
    expect(
      await client.storeChangeEvent.count({ where: { shopId: shop.id, kind: "theme_updated" } }),
    ).toBe(1);
  });
});

async function isolatedClient() {
  const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-phase4-"));
  const databasePath = join(directory, "test.db");
  await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
  const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
  clients.push(client);
  return client;
}
