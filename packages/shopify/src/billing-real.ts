import { BILLING_TRIAL_DAYS, PLANS, type PlanName } from "@checkoutwatch/core";
import type { AdminGraphqlClient, BillingAdapter, BillingStore } from "./types.js";

export class GraphqlBillingAdapter implements BillingAdapter {
  constructor(
    private readonly client: AdminGraphqlClient,
    private readonly store?: BillingStore,
  ) {}

  async getActivePlan(shopDomain: string): Promise<PlanName> {
    const result = await this.client.graphql<ActiveSubscriptionsResponse>(
      ACTIVE_SUBSCRIPTIONS_QUERY,
    );
    const active = result.currentAppInstallation.activeSubscriptions.find(
      (subscription) => subscription.status === "ACTIVE",
    );
    const plan = planFromSubscriptionName(active?.name);
    if (this.store)
      await this.store.activate(
        active
          ? {
              shopDomain,
              plan,
              status: active.status,
              shopifySubscriptionId: active.id,
            }
          : { shopDomain, plan: "free", status: "ACTIVE" },
      );
    return plan;
  }

  async ensureSubscription(shopDomain: string, plan: PlanName, returnUrl: string) {
    if (plan === "free") {
      await this.store?.activate({ shopDomain, plan, status: "ACTIVE" });
      return { active: true };
    }
    if ((await this.getActivePlan(shopDomain)) === plan) return { active: true };
    const definition = PLANS[plan];
    const result = await this.client.graphql<SubscriptionCreateResponse>(
      APP_SUBSCRIPTION_CREATE_MUTATION,
      {
        name: subscriptionName(plan),
        returnUrl,
        trialDays: BILLING_TRIAL_DAYS,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: definition.priceMonthlyUsd, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    );
    const payload = result.appSubscriptionCreate;
    if (payload.userErrors.length)
      throw new Error(
        payload.userErrors
          .map((error) => `${error.field?.join(".") ?? "subscription"}: ${error.message}`)
          .join("; "),
      );
    if (!payload.confirmationUrl || !payload.appSubscription)
      throw new Error("Shopify did not return a subscription confirmation URL");
    await this.store?.activate({
      shopDomain,
      plan,
      status: "PENDING",
      shopifySubscriptionId: payload.appSubscription.id,
    });
    return { active: false, confirmationUrl: payload.confirmationUrl };
  }
}

export async function handleSubscriptionUpdate(
  store: BillingStore,
  shopDomain: string,
  payload: { id?: string; name?: string; status?: string },
) {
  if (!payload.status) throw new Error("Subscription webhook is missing status");
  const status = payload.status.toUpperCase();
  const plan = status === "ACTIVE" ? planFromSubscriptionName(payload.name) : "free";
  await store.activate({
    shopDomain,
    plan,
    status,
    ...(payload.id ? { shopifySubscriptionId: payload.id } : {}),
  });
  return plan;
}

export const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query CheckoutWatchActiveSubscriptions {
    currentAppInstallation { activeSubscriptions { id name status } }
  }
`;

export const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation CheckoutWatchAppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, trialDays: $trialDays, lineItems: $lineItems) {
      appSubscription { id name status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

function subscriptionName(plan: Exclude<PlanName, "free">) {
  return `CheckoutWatch ${PLANS[plan].label}`;
}
function planFromSubscriptionName(name?: string): PlanName {
  const normalized = name?.toLowerCase() ?? "";
  if (normalized.includes("pro")) return "pro";
  if (normalized.includes("growth")) return "growth";
  return "free";
}

interface ActiveSubscriptionsResponse {
  currentAppInstallation: {
    activeSubscriptions: Array<{ id: string; name: string; status: string }>;
  };
}
interface SubscriptionCreateResponse {
  appSubscriptionCreate: {
    appSubscription: { id: string } | null;
    confirmationUrl: string | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
}
