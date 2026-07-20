import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { Form, useLoaderData } from "react-router";
import { useState } from "react";
import { formBoolean, formString } from "../services/form.server.js";
import { requestContext } from "../services/request.server.js";
import { statusPageService } from "../services/status-page.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, runtime } = await requestContext(request);
  return statusPageService(runtime.client).settings(shop.id);
}

export async function action({ request }: { request: Request }) {
  const { shop, runtime } = await requestContext(request);
  const form = await request.formData();
  return statusPageService(runtime.client).saveSettings(shop.id, {
    slug: formString(form, "slug"),
    title: formString(form, "title"),
    enabled: formBoolean(form, "enabled"),
  });
}

export function StatusPageSettings({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [slug, setSlug] = useState(data.page?.slug ?? "dev-shop");
  const [title, setTitle] = useState(data.page?.title ?? "Checkout status");
  const [enabled, setEnabled] = useState(data.page?.enabled ?? false);
  return (
    <Page title="Public status page" backAction={{ content: "Settings", url: "/settings" }}>
      <BlockStack gap="400">
        {!data.entitled ? (
          <Banner title="Public status pages are available on Pro" tone="info">
            <p>Upgrade to publish checkout uptime and sanitized incident history.</p>
            <Button url="/billing">View Pro plan</Button>
          </Banner>
        ) : null}
        <Card>
          <Form method="post">
            <FormLayout>
              <TextField
                label="Page title"
                name="title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                maxLength={100}
              />
              <TextField
                label="Public slug"
                name="slug"
                value={slug}
                onChange={setSlug}
                autoComplete="off"
                prefix="/status/"
                helpText="3-63 lowercase letters, numbers, and hyphens."
              />
              <Checkbox
                label="Publish this status page"
                name="enabled"
                checked={enabled}
                onChange={setEnabled}
                disabled={!data.entitled}
              />
              <Button submit disabled={!data.entitled}>
                Save status page
              </Button>
            </FormLayout>
          </Form>
        </Card>
        <Text as="p" tone="subdued">
          Only generic availability information is public. Diagnostics, evidence, screenshots, URLs,
          and store configuration remain private.
        </Text>
      </BlockStack>
    </Page>
  );
}

export default function StatusPageSettingsRoute() {
  return <StatusPageSettings data={useLoaderData<typeof loader>()} />;
}
