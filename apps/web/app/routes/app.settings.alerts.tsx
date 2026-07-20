import {
  Badge,
  BlockStack,
  Button,
  Card,
  DataTable,
  FormLayout,
  Page,
  Select,
  TextField,
} from "@shopify/polaris";
import { Form, useLoaderData } from "react-router";
import { useState } from "react";
import { PLAN_ENTITLEMENTS, type ChannelType } from "@checkoutwatch/core";
import { requestContext } from "../services/request.server.js";
import { formString } from "../services/form.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, service } = await requestContext(request);
  return { shop, ...(await service.alertSettings(shop.id)) };
}

export async function action({ request }: { request: Request }) {
  const { shop, service } = await requestContext(request);
  const form = await request.formData();
  if (form.get("intent") === "test") await service.testAlerts(shop.id, shop.plan);
  else {
    const channel = formString(form, "channel");
    if (!isChannel(channel)) throw new Response("Invalid channel", { status: 400 });
    const destination = formString(form, "destination").trim();
    if (!destination) throw new Response("Destination is required", { status: 400 });
    await service.saveChannel(shop.id, shop.plan, channel, destination);
  }
  return { ok: true };
}

export function AlertSettingsPage({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const allowed = PLAN_ENTITLEMENTS[data.plan].channels as readonly ChannelType[];
  const [channel, setChannel] = useState<ChannelType>(allowed[0] ?? "email");
  const [destination, setDestination] = useState("");
  return (
    <Page
      title="Alert settings"
      backAction={{ content: "Dashboard", url: "/" }}
      primaryAction={{
        content: "Test my alerts",
        onAction: () =>
          (document.getElementById("test-alerts-form") as HTMLFormElement | null)?.requestSubmit(),
      }}
    >
      <BlockStack gap="400">
        <Card>
          <Form method="post">
            <FormLayout>
              <Select
                label="Channel"
                name="channel"
                value={channel}
                onChange={(value) => setChannel(value as ChannelType)}
                options={(["email", "slack", "discord", "sms"] as const).map((option) => ({
                  label: allowed.includes(option) ? option : `${option} — upgrade required`,
                  value: option,
                  disabled: !allowed.includes(option),
                }))}
              />
              <TextField
                label="Destination"
                name="destination"
                value={destination}
                onChange={setDestination}
                autoComplete="off"
                helpText="Use mock://... locally to guarantee delivery to the mock outbox."
              />
              <Button submit>Save channel</Button>
            </FormLayout>
          </Form>
        </Card>
        <Form method="post" id="test-alerts-form">
          <input type="hidden" name="intent" value="test" />
          <Button submit variant="primary">
            Test my alerts
          </Button>
        </Form>
        <Card>
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Channel", "Destination", "Enabled"]}
            rows={data.channels.map((channel) => [
              channel.type,
              channel.destination,
              channel.enabled ? "Yes" : "No",
            ])}
          />
        </Card>
        <Card>
          <DataTable
            columnContentTypes={["text", "text", "text", "text"]}
            headings={["Sent", "Channel", "Destination", "Status"]}
            rows={data.deliveries.map((delivery) => [
              new Date(delivery.createdAt).toLocaleString(),
              delivery.channelType,
              delivery.destination,
              <Badge
                key={delivery.id}
                {...(delivery.status === "delivered"
                  ? { tone: "success" as const }
                  : delivery.status === "skipped"
                    ? { tone: "attention" as const }
                    : {})}
              >
                {delivery.status}
              </Badge>,
            ])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}

export default function AlertSettingsRoute() {
  return <AlertSettingsPage data={useLoaderData<typeof loader>()} />;
}
function isChannel(value: string): value is ChannelType {
  return value === "email" || value === "slack" || value === "discord" || value === "sms";
}
