import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { Link, useLoaderData } from "react-router";
import { Sparkline } from "../components/sparkline.js";
import { requestContext } from "../services/request.server.js";

export async function loader({ request }: { request: Request }) {
  const { shop, service } = await requestContext(request);
  return {
    monitors: await service.dashboard(shop.id),
    reconciliation: await service.reconciliation(shop.id),
  };
}

type DashboardData = Awaited<ReturnType<typeof loader>>;

export function DashboardPage({ data }: { data: DashboardData }) {
  return (
    <Page
      title="Checkout status"
      primaryAction={{ content: "Set up a monitor", url: "/monitors/new" }}
    >
      {Array.isArray(data.reconciliation.pausedMonitors) &&
      data.reconciliation.pausedMonitors.length > 0 ? (
        <Banner tone="warning" title="Some features were paused after your plan change">
          <p>Review Billing to restore paused monitors or channels.</p>
        </Banner>
      ) : null}
      {data.monitors.length === 0 ? (
        <Card>
          <EmptyState
            heading="Test your checkout automatically"
            action={{ content: "Pick a product", url: "/monitors/new" }}
            image=""
          >
            <p>
              Choose one real product. CheckoutWatch generates and runs the checkout test for you.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <BlockStack gap="400">
          {data.monitors.map((monitor) => (
            <Card key={monitor.id}>
              <BlockStack gap="300">
                {monitor.openIncident ? (
                  <Banner tone="critical" title="Checkout incident in progress">
                    <p>{monitor.openIncident.failureCode}</p>
                    <Button url={`/incidents/${monitor.openIncident.id}`}>View incident</Button>
                  </Banner>
                ) : null}
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {monitor.name}
                  </Text>
                  <Badge
                    tone={
                      monitor.lastStatus === "passed"
                        ? "success"
                        : monitor.lastStatus === "failed"
                          ? "critical"
                          : "attention"
                    }
                  >
                    {monitor.lastStatus ?? "pending"}
                  </Badge>
                </InlineStack>
                <InlineStack gap="600" wrap>
                  <Text as="p">7-day uptime: {formatUptime(monitor.uptime7)}</Text>
                  <Text as="p">30-day uptime: {formatUptime(monitor.uptime30)}</Text>
                  <Sparkline
                    values={monitor.responseTimes}
                    label={`${monitor.name} response time trend`}
                  />
                </InlineStack>
                <InlineStack gap="300">
                  <Button url={`/monitors/${monitor.id}`}>Run history</Button>
                  {monitor.incidents[0] ? (
                    <Button url={`/incidents/${monitor.incidents[0].id}`}>Latest incident</Button>
                  ) : null}
                </InlineStack>
                {monitor.incidents.length > 0 ? (
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">
                      Recent incidents
                    </Text>
                    {monitor.incidents.slice(0, 3).map((incident) => (
                      <Text as="p" key={incident.id}>
                        <Link to={`/incidents/${incident.id}`}>{incident.failureCode}</Link> —{" "}
                        {incident.status} — {new Date(incident.openedAt).toLocaleString()}
                      </Text>
                    ))}
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>
          ))}
        </BlockStack>
      )}
    </Page>
  );
}

export default function DashboardRoute() {
  return <DashboardPage data={useLoaderData<typeof loader>()} />;
}

function formatUptime(value: number | null) {
  return value === null ? "No data" : `${value.toFixed(2)}%`;
}
