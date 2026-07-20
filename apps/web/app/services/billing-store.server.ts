import type { PrismaClient } from "@prisma/client";
import type { BillingStore } from "@checkoutwatch/shopify";
import type { PlanName } from "@checkoutwatch/core";

export class PrismaBillingStore implements BillingStore {
  constructor(private readonly client: PrismaClient) {}

  async activePlan(shopDomain: string): Promise<PlanName> {
    const shop = await this.client.shop.findUniqueOrThrow({ where: { shopDomain } });
    return normalizePlan(shop.plan);
  }

  async activate(input: {
    shopDomain: string;
    plan: PlanName;
    status: string;
    shopifySubscriptionId?: string;
  }) {
    const shop = await this.client.shop.findUniqueOrThrow({
      where: { shopDomain: input.shopDomain },
    });
    const applyPlan = input.status === "ACTIVE" || input.plan === "free";
    await this.client.$transaction([
      this.client.billingSubscription.upsert({
        where: { shopId: shop.id },
        update: {
          plan: input.plan,
          status: input.status,
          ...(input.shopifySubscriptionId
            ? { shopifySubscriptionId: input.shopifySubscriptionId }
            : {}),
          ...(input.status === "ACTIVE" ? { activatedAt: new Date() } : {}),
        },
        create: {
          shopId: shop.id,
          plan: input.plan,
          status: input.status,
          ...(input.shopifySubscriptionId
            ? { shopifySubscriptionId: input.shopifySubscriptionId }
            : {}),
          ...(input.status === "ACTIVE" ? { activatedAt: new Date() } : {}),
        },
      }),
      ...(applyPlan
        ? [this.client.shop.update({ where: { id: shop.id }, data: { plan: input.plan } })]
        : []),
    ]);
  }
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}
