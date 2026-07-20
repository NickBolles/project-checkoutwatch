import { describe, expect, it } from "vitest";
import {
  APP_SUBSCRIPTION_CREATE_MUTATION,
  GraphqlBillingAdapter,
  MockBillingAdapter,
  handleSubscriptionUpdate,
  type AdminGraphqlClient,
  type BillingStore,
} from "../src/index.js";

describe("billing adapters", () => {
  it("builds the current appSubscriptionCreate shape with a 14-day trial", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
    const client: AdminGraphqlClient = {
      async graphql<T>(query: string, variables?: Record<string, unknown>) {
        calls.push({ query, ...(variables ? { variables } : {}) });
        if (query.includes("activeSubscriptions"))
          return { currentAppInstallation: { activeSubscriptions: [] } } as T;
        return {
          appSubscriptionCreate: {
            appSubscription: { id: "gid://shopify/AppSubscription/1" },
            confirmationUrl: "https://shopify.test/confirm",
            userErrors: [],
          },
        } as T;
      },
    };
    const result = await new GraphqlBillingAdapter(client).ensureSubscription(
      "shop.test",
      "growth",
      "https://app.test/billing",
    );
    expect(result).toEqual({ active: false, confirmationUrl: "https://shopify.test/confirm" });
    expect(calls[1]).toMatchObject({
      query: APP_SUBSCRIPTION_CREATE_MUTATION,
      variables: {
        name: "CheckoutWatch Growth",
        returnUrl: "https://app.test/billing",
        trialDays: 14,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 19, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    });
  });

  it("mock activation and subscription webhooks transition stored plans", async () => {
    const store = new MemoryBillingStore();
    const mock = new MockBillingAdapter(store);
    expect(await mock.ensureSubscription("shop.test", "pro", "unused")).toEqual({ active: true });
    expect(await store.activePlan("shop.test")).toBe("pro");
    expect(
      await handleSubscriptionUpdate(store, "shop.test", {
        id: "sub-1",
        name: "CheckoutWatch Growth",
        status: "ACTIVE",
      }),
    ).toBe("growth");
    expect(
      await handleSubscriptionUpdate(store, "shop.test", {
        id: "sub-1",
        name: "CheckoutWatch Growth",
        status: "CANCELLED",
      }),
    ).toBe("free");
  });
});

class MemoryBillingStore implements BillingStore {
  plan: "free" | "growth" | "pro" = "free";
  activePlan(_shopDomain: string): Promise<"free" | "growth" | "pro"> {
    return Promise.resolve(this.plan);
  }
  activate(input: { plan: "free" | "growth" | "pro" }) {
    this.plan = input.plan;
    return Promise.resolve();
  }
}
