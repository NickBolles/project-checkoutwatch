import { afterEach, describe, expect, it } from "vitest";
import { AppProvider } from "@shopify/polaris";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { MockBillingAdapter } from "@checkoutwatch/shopify";
import { MockAdapter } from "@checkoutwatch/alerts";
import type { EnqueueOpts, JobHandler, JobQueue, ProcessorHandle } from "@checkoutwatch/queue";
import { PrismaBillingStore } from "../app/services/billing-store.server.js";
import { WebAppService } from "../app/services/web-app.server.js";
import { BillingPage } from "../app/routes/app.billing.js";
import { isolatedClient } from "./helpers.js";

const clients: Array<Awaited<ReturnType<typeof isolatedClient>>["client"]> = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.$disconnect())));

describe("Phase 7 mock billing and server gates", () => {
  it("blocks on free, upgrades instantly, and changes server-side creation/channel limits", async () => {
    const { client, directory } = await isolatedClient();
    clients.push(client);
    const shop = await client.shop.create({
      data: {
        shopDomain: "phase7-upgrade.test",
        storefrontUrl: "http://localhost:4600",
        plan: "free",
      },
    });
    const service = new WebAppService(client, new NoopQueue(), []);
    await service.createMonitor({
      shopId: shop.id,
      plan: "free",
      product: { handle: "one", title: "One" },
      requestedInterval: 5,
    });
    await expect(
      service.createMonitor({
        shopId: shop.id,
        plan: "free",
        product: { handle: "two", title: "Two" },
        requestedInterval: 5,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await client.entitlementLog.findFirst({
        where: { shopId: shop.id, feature: "monitor_create" },
      }),
    ).toMatchObject({ action: "skipped", reason: expect.stringContaining("allows 1") });

    await new MockBillingAdapter(new PrismaBillingStore(client)).ensureSubscription(
      shop.shopDomain,
      "growth",
      "unused",
    );
    expect((await client.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("growth");
    const second = await service.createMonitor({
      shopId: shop.id,
      plan: "growth",
      product: { handle: "two", title: "Two" },
      requestedInterval: 5,
    });
    expect(second.intervalMinutes).toBe(10);
    await service.saveChannel(shop.id, "growth", "slack", "mock://slack");
    expect(
      await client.alertChannelConfig.count({ where: { shopId: shop.id, type: "slack" } }),
    ).toBe(1);

    await new PrismaBillingStore(client).activate({
      shopDomain: shop.shopDomain,
      plan: "free",
      status: "CANCELLED",
    });
    expect((await client.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("free");
    const gatedService = new WebAppService(client, new NoopQueue(), [
      new MockAdapter("slack", directory),
    ]);
    await gatedService.testAlerts(shop.id, "free");
    expect(
      await client.alertDelivery.findFirstOrThrow({
        where: { shopId: shop.id, channelType: "slack" },
      }),
    ).toMatchObject({ status: "skipped", errorDetail: "plan free does not include slack" });
    expect(
      await client.entitlementLog.findFirst({
        where: { shopId: shop.id, feature: "channel:slack" },
      }),
    ).toMatchObject({ action: "skipped", reason: expect.stringContaining("plan free") });
  });

  it("renders the billing comparison and instant mock-upgrade CTA in the route smoke", () => {
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <AppProvider i18n={{}}>
              <BillingPage data={{ currentPlan: "free", mock: true, changed: false }} />
            </AppProvider>
          ),
        },
      ],
      { initialEntries: ["/billing"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Plans and billing");
    expect(html).toContain("$19");
    expect(html).toContain("Switch to Growth");
  });
});

class NoopQueue implements JobQueue {
  add<T>(_name: string, _payload: T, options?: EnqueueOpts) {
    return Promise.resolve(options?.jobId ?? "job");
  }
  process<T>(_name: string, _handler: JobHandler<T>): Promise<ProcessorHandle> {
    return Promise.resolve({ close: () => Promise.resolve() });
  }
  cancelWhere(): Promise<number> {
    return Promise.resolve(0);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
