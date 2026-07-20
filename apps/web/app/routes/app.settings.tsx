import {
  Badge,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { Form, useLoaderData } from "react-router";
import { useState } from "react";
import { requestContext } from "../services/request.server.js";
import { formString } from "../services/form.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, service } = await requestContext(request);
  return { shop: await service.settings(shop.id) };
}

export async function action({ request }: { request: Request }) {
  const { shop, service } = await requestContext(request);
  const form = await request.formData();
  await service.updateStorefront(shop.id, formString(form, "storefrontUrl"));
  return { ok: true };
}

export default function SettingsRoute() {
  const { shop } = useLoaderData<typeof loader>();
  const [storefrontUrl, setStorefrontUrl] = useState(shop.storefrontUrl);
  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/" }}>
      <BlockStack gap="400">
        <Card>
          <Text as="h2" variant="headingMd">
            Plan
          </Text>
          <InlineStack gap="300">
            <Badge>{shop.plan}</Badge>
            <Button url="/billing">Manage billing</Button>
          </InlineStack>
        </Card>
        <Card>
          <Form method="post">
            <FormLayout>
              <TextField
                label="Storefront URL"
                name="storefrontUrl"
                value={storefrontUrl}
                onChange={setStorefrontUrl}
                autoComplete="url"
              />
              <Button submit>Save storefront</Button>
            </FormLayout>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
