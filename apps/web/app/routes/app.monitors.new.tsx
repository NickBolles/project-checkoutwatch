import { Banner, BlockStack, Card, FormLayout, Page, Select, Text } from "@shopify/polaris";
import { useState } from "react";
import { Form, redirect, useLoaderData } from "react-router";
import { PLAN_ENTITLEMENTS } from "@checkoutwatch/core";
import { requestContext } from "../services/request.server.js";
import { formString } from "../services/form.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, admin } = await requestContext(request);
  return {
    shop,
    products: await admin.listProducts(shop.domain),
    minimumInterval: PLAN_ENTITLEMENTS[shop.plan].minIntervalMinutes,
  };
}

export async function action({ request }: { request: Request }) {
  const { shop, admin, service } = await requestContext(request);
  const form = await request.formData();
  const handle = formString(form, "productHandle");
  const products = await admin.listProducts(shop.domain);
  const product = products.find((candidate) => candidate.handle === handle);
  if (!product) throw new Response("Choose a valid product", { status: 400 });
  const variant = product.variants.find((candidate) => candidate.available);
  const monitor = await service.createMonitor({
    shopId: shop.id,
    plan: shop.plan,
    product: {
      handle: product.handle,
      title: product.title,
      ...(variant ? { variantId: variant.id.replace(/^.*\//, "") } : {}),
    },
    requestedInterval: Number(formString(form, "intervalMinutes")),
  });
  return redirect(`/monitors/${monitor.id}?created=1`);
}

export function MonitorWizardPage({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [productHandle, setProductHandle] = useState(data.products[0]?.handle ?? "");
  const intervals = [5, 10, 15, 30, 60].filter((minutes) => minutes >= data.minimumInterval);
  const [interval, setIntervalValue] = useState(String(intervals[0] ?? data.minimumInterval));
  return (
    <Page title="Create a checkout monitor" backAction={{ content: "Dashboard", url: "/" }}>
      <BlockStack gap="400">
        <Banner title="No code required">
          <p>
            Pick a product and CheckoutWatch will test add-to-cart through the payment step without
            entering customer or payment data.
          </p>
        </Banner>
        <Card>
          <Form method="post">
            <FormLayout>
              <Select
                label="Product"
                name="productHandle"
                value={productHandle}
                onChange={setProductHandle}
                options={data.products.map((product) => ({
                  label: product.title,
                  value: product.handle,
                }))}
              />
              <Select
                label="Check interval"
                name="intervalMinutes"
                value={interval}
                onChange={setIntervalValue}
                helpText={`Your ${data.shop.plan} plan supports checks every ${data.minimumInterval} minutes or slower.`}
                options={intervals.map((minutes) => ({
                  label: `Every ${minutes} minutes`,
                  value: String(minutes),
                }))}
              />
              <button
                className="Polaris-Button Polaris-Button--pressable Polaris-Button--variantPrimary"
                type="submit"
              >
                <span className="Polaris-Text--root">Create and run first test</span>
              </button>
            </FormLayout>
          </Form>
        </Card>
        <Text as="p" tone="subdued">
          Need a faster interval or more monitors? Plan limits are enforced on the server as well as
          shown here.
        </Text>
      </BlockStack>
    </Page>
  );
}

export default function MonitorWizardRoute() {
  return <MonitorWizardPage data={useLoaderData<typeof loader>()} />;
}
