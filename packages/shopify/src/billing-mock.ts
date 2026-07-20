import type { PlanName } from "@checkoutwatch/core";
import type { BillingAdapter, BillingStore } from "./types.js";

export class MockBillingAdapter implements BillingAdapter {
  constructor(private readonly store: BillingStore) {}
  getActivePlan(shopDomain: string): Promise<PlanName> {
    return this.store.activePlan(shopDomain);
  }
  async ensureSubscription(shopDomain: string, plan: PlanName, _returnUrl: string) {
    await this.store.activate({
      shopDomain,
      plan,
      status: "ACTIVE",
      ...(plan === "free" ? {} : { shopifySubscriptionId: `mock://${shopDomain}/${plan}` }),
    });
    return { active: true };
  }
}
