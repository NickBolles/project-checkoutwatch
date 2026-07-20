import { Badge, BlockStack, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { Form, redirect, useLoaderData } from "react-router";
import { PLANS, type PlanName } from "@checkoutwatch/core";
import { formString } from "../services/form.server.js";
import { requestContext } from "../services/request.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, billing } = await requestContext(request);
  return {
    currentPlan: await billing.getActivePlan(shop.domain),
    mock: process.env.SHOPIFY_AUTH !== "real",
    changed: new URL(request.url).searchParams.has("changed"),
  };
}

export async function action({ request }: { request: Request }) {
  const { shop, billing, runtime } = await requestContext(request);
  const form = await request.formData();
  const plan = formString(form, "plan");
  if (!isPlan(plan)) throw new Response("Invalid plan", { status: 400 });
  const result = await billing.ensureSubscription(
    shop.domain,
    plan,
    new URL("/billing?changed=1", request.url).toString(),
  );
  if (result.confirmationUrl) return redirect(result.confirmationUrl);
  await runtime.queue.add(
    "reconcile-plan",
    { shopId: shop.id, previousPlan: shop.plan },
    { jobId: `reconcile:${shop.id}:${plan}:${Date.now()}` },
  );
  return redirect("/billing?changed=1");
}

export function BillingPage({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  return (
    <Page title="Plans and billing" backAction={{ content: "Dashboard", url: "/" }}>
      <BlockStack gap="400">
        {data.changed ? (
          <Card>
            <Text as="p">
              Plan updated. CheckoutWatch is reconciling monitor and alert limits now.
            </Text>
          </Card>
        ) : null}
        <InlineStack gap="400" align="center" blockAlign="stretch">
          {Object.values(PLANS).map((plan) => (
            <Card key={plan.name}>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">
                    {plan.label}
                  </Text>
                  {data.currentPlan === plan.name ? <Badge tone="success">Current</Badge> : null}
                </InlineStack>
                <Text as="p" variant="heading2xl">
                  ${plan.priceMonthlyUsd}
                  <Text as="span" variant="bodySm">
                    /month
                  </Text>
                </Text>
                <Text as="p">
                  {plan.entitlements.maxMonitors} monitor(s), checks every{" "}
                  {plan.entitlements.minIntervalMinutes}+ minutes
                </Text>
                <Text as="p">Channels: {plan.entitlements.channels.join(", ")}</Text>
                <Text as="p">
                  {plan.trialDays ? `${plan.trialDays}-day trial` : "No card required"}
                </Text>
                <Form method="post">
                  <input type="hidden" name="plan" value={plan.name} />
                  <Button
                    submit
                    variant={data.currentPlan === plan.name ? "plain" : "primary"}
                    disabled={data.currentPlan === plan.name}
                  >
                    {data.currentPlan === plan.name
                      ? "Current plan"
                      : data.mock
                        ? `Switch to ${plan.label}`
                        : `Choose ${plan.label}`}
                  </Button>
                </Form>
              </BlockStack>
            </Card>
          ))}
        </InlineStack>
      </BlockStack>
    </Page>
  );
}

export default function BillingRoute() {
  return <BillingPage data={useLoaderData<typeof loader>()} />;
}
function isPlan(value: string): value is PlanName {
  return value === "free" || value === "growth" || value === "pro";
}
