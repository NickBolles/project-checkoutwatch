import { Badge, BlockStack, Card, DataTable, InlineStack, Page, Text } from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { requestContext } from "../services/request.server.js";

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  if (!params.id) throw new Response("Incident not found", { status: 404 });
  const { shop, service } = await requestContext(request);
  return { incident: await service.incident(shop.id, params.id) };
}

type IncidentData = Awaited<ReturnType<typeof loader>>;

export function IncidentDetailPage({ data }: { data: IncidentData }) {
  const incident = data.incident;
  const diagnosis = asRecord(incident.diagnosis);
  const consoleEntries = Array.isArray(incident.openingRun.console)
    ? incident.openingRun.console
    : [];
  const failedRequests = Array.isArray(incident.openingRun.failedRequests)
    ? incident.openingRun.failedRequests
    : [];
  return (
    <Page
      title={`Incident: ${incident.monitor.name}`}
      backAction={{ content: "Dashboard", url: "/" }}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              AI diagnosis
            </Text>
            <Badge tone={incident.status === "open" ? "critical" : "success"}>
              {incident.status}
            </Badge>
          </InlineStack>
          <BlockStack gap="200">
            <Text as="p" variant="headingLg">
              {textValue(diagnosis.summary) ?? incident.failureCode}
            </Text>
            <Text as="p">
              Probable cause:{" "}
              {textValue(diagnosis.probableCause) ?? "Diagnosis is still being prepared."}
            </Text>
            <Text as="p">
              Recommended action:{" "}
              {textValue(diagnosis.recommendedAction) ?? "Review the captured evidence below."}
            </Text>
          </BlockStack>
        </Card>
        {incident.openingRun.screenshotPath ? (
          <Card>
            <Text as="h2" variant="headingMd">
              Checkout screenshot
            </Text>
            <img
              style={{ width: "100%", maxWidth: 1000 }}
              alt="Checkout at the time of failure"
              src={`/artifacts/${incident.openingRun.id}/${encodeURIComponent(fileName(incident.openingRun.screenshotPath))}`}
            />
          </Card>
        ) : null}
        <Card>
          <Text as="h2" variant="headingMd">
            Console evidence
          </Text>
          {consoleEntries.length ? (
            <pre>{JSON.stringify(consoleEntries, null, 2)}</pre>
          ) : (
            <Text as="p" tone="subdued">
              No warning or error messages were captured.
            </Text>
          )}
        </Card>
        <Card>
          <Text as="h2" variant="headingMd">
            Failed network requests
          </Text>
          {failedRequests.length ? (
            <pre>{JSON.stringify(failedRequests, null, 2)}</pre>
          ) : (
            <Text as="p" tone="subdued">
              No failed requests were captured.
            </Text>
          )}
        </Card>
        <Card>
          <Text as="h2" variant="headingMd">
            What changed right before
          </Text>
          {incident.changes.length ? (
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["Detected", "Kind", "Detail"]}
              rows={incident.changes.map((change) => [
                new Date(change.detectedAt).toLocaleString(),
                change.kind,
                JSON.stringify(change.detail),
              ])}
            />
          ) : (
            <Text as="p" tone="subdued">
              No detected theme or script-origin changes.
            </Text>
          )}
        </Card>
        <Card>
          <Text as="h2" variant="headingMd">
            Timeline
          </Text>
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Time", "Status", "Code"]}
            rows={incident.timeline.map((run) => [
              new Date(run.startedAt).toLocaleString(),
              run.status,
              run.failureCode ?? "—",
            ])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}

export default function IncidentDetailRoute() {
  return <IncidentDetailPage data={useLoaderData<typeof loader>()} />;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function textValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
function fileName(value: string) {
  return value.replaceAll("\\", "/").split("/").at(-1) ?? "failure.png";
}
