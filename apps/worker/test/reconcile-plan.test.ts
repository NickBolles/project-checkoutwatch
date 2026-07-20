import { afterEach, describe, expect, it } from "vitest";
import { createReconcilePlanHandler } from "../src/jobs/reconcile-plan.js";
import { createPrismaClient } from "@checkoutwatch/db";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const clients: Array<ReturnType<typeof createPrismaClient>> = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.$disconnect())));

describe("downgrade reconciliation", () => {
  it("keeps the oldest free monitor and logs every paused or disabled feature", async () => {
    const client = await isolatedClient();
    const shop = await client.shop.create({
      data: {
        shopDomain: "reconcile.test",
        storefrontUrl: "https://reconcile.test",
        plan: "pro",
        channels: {
          create: [
            { type: "email", destination: "mock://email" },
            { type: "sms", destination: "mock://sms" },
          ],
        },
        statusPage: { create: { slug: "reconcile", title: "Status", enabled: true } },
      },
    });
    for (let index = 0; index < 5; index += 1)
      await client.monitor.create({
        data: {
          shopId: shop.id,
          name: `Monitor ${index}`,
          productHandle: `p${index}`,
          productTitle: `P${index}`,
          intervalMinutes: 5,
          createdAt: new Date(1_000 + index),
        },
      });
    await client.shop.update({ where: { id: shop.id }, data: { plan: "free" } });
    await createReconcilePlanHandler(client)({ shopId: shop.id, previousPlan: "pro" });
    const monitors = await client.monitor.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "asc" },
    });
    expect(monitors.filter((monitor) => monitor.enabled).map((monitor) => monitor.name)).toEqual([
      "Monitor 0",
    ]);
    expect(monitors.every((monitor) => monitor.intervalMinutes === 60)).toBe(true);
    expect(
      await client.alertChannelConfig.findFirstOrThrow({ where: { shopId: shop.id, type: "sms" } }),
    ).toMatchObject({ enabled: false });
    expect(
      await client.entitlementLog.count({ where: { shopId: shop.id, action: "skipped" } }),
    ).toBe(6);
    expect(await client.statusPage.findUniqueOrThrow({ where: { shopId: shop.id } })).toMatchObject({
      enabled: false,
    });
    expect(
      JSON.parse(
        (await client.shop.findUniqueOrThrow({ where: { id: shop.id } })).reconciliationJson,
      ),
    ).toMatchObject({ plan: "free", pausedMonitors: expect.any(Array), disabledChannels: ["sms"] });
  });
});

async function isolatedClient() {
  const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-reconcile-"));
  const path = join(directory, "test.db");
  await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), path);
  const client = createPrismaClient(`file:${path.replaceAll("\\", "/")}`);
  clients.push(client);
  return client;
}
