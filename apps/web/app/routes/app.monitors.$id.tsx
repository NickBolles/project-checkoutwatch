import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { Form, useLoaderData } from "react-router";
import { useRevalidator } from "react-router";
import { useEffect } from "react";
import { Sparkline } from "../components/sparkline.js";
import { requestContext } from "../services/request.server.js";
import { formString } from "../services/form.server.js";

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  if (!params.id) throw new Response("Monitor not found", { status: 404 });
  const { shop, service } = await requestContext(request);
  const monitor = await service.monitor(shop.id, params.id);
  return { monitor, created: new URL(request.url).searchParams.has("created") };
}

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  if (!params.id) throw new Response("Monitor not found", { status: 404 });
  const { shop, service } = await requestContext(request);
  const form = await request.formData();
  const intent = formString(form, "intent");
  if (intent === "run") await service.runNow(shop.id, params.id);
  else await service.setMonitorEnabled(shop.id, params.id, intent === "enable");
  return { ok: true };
}

export function MonitorDetailPage({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const monitor = data.monitor;
  return (
    <Page title={monitor.name} backAction={{ content: "Dashboard", url: "/" }}>
      <BlockStack gap="400">
        {data.created ? (
          <Banner tone="success" title="Monitor created">
            <p>
              The first real checkout test is queued. Refresh this page in a moment to see its
              result.
            </p>
          </Banner>
        ) : null}
        <Card>
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Current status
            </Text>
            <Badge tone={monitor.lastStatus === "passed" ? "success" : "attention"}>
              {monitor.lastStatus ?? "pending"}
            </Badge>
          </InlineStack>
          <Sparkline
            values={monitor.runs
              .filter((run) => run.durationMs !== null)
              .map((run) => run.durationMs as number)
              .reverse()}
            label="Response time trend"
          />
          <InlineStack gap="300">
            <Form method="post">
              <input type="hidden" name="intent" value="run" />
              <Button submit disabled={!monitor.enabled}>
                Run now
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value={monitor.enabled ? "disable" : "enable"} />
              <Button submit>{monitor.enabled ? "Disable" : "Enable"}</Button>
            </Form>
          </InlineStack>
        </Card>
        <Card>
          <DataTable
            columnContentTypes={["text", "text", "numeric", "text"]}
            headings={["Started", "Status", "Duration", "Failure"]}
            rows={monitor.runs.map((run) => [
              new Date(run.startedAt).toLocaleString(),
              run.status,
              run.durationMs === null ? "—" : `${run.durationMs} ms`,
              run.failureCode ?? "—",
            ])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}

export default function MonitorDetailRoute() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!data.created || data.monitor.runs.length > 0) return;
    const timer = window.setInterval(() => void revalidator.revalidate(), 1000);
    return () => window.clearInterval(timer);
  }, [data.created, data.monitor.runs.length, revalidator]);
  return <MonitorDetailPage data={data} />;
}
