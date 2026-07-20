import { AppProvider } from "@shopify/polaris";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "../app/routes/app._index.js";
import { MonitorWizardPage } from "../app/routes/app.monitors.new.js";
import { IncidentDetailPage } from "../app/routes/app.incidents.$id.js";

describe("Phase 6 route render smoke", () => {
  it("renders dashboard, wizard, and incident detail without a browser", () => {
    const dashboard = render(
      <DashboardPage
        data={{
          monitors: [
            {
              id: "m1",
              name: "Fixture checkout",
              enabled: true,
              lastStatus: "passed",
              lastRunAt: new Date().toISOString(),
              uptime7: 99.9,
              uptime30: 99.8,
              responseTimes: [300, 250, 280],
              openIncident: null,
              incidents: [],
            },
          ],
          reconciliation: {},
        }}
      />,
    );
    expect(dashboard).toContain("Checkout status");
    expect(dashboard).toContain("99.90%");

    const wizard = render(
      <MonitorWizardPage
        data={{
          shop: { id: "s1", domain: "dev-shop.myshopify.com", plan: "free" },
          products: [
            {
              id: "p1",
              handle: "test-product",
              title: "Fixture product",
              variants: [{ id: "1001", title: "Default", available: true }],
            },
          ],
          minimumInterval: 60,
        }}
      />,
    );
    expect(wizard).toContain("Create a checkout monitor");
    expect(wizard).toContain("Fixture product");

    const incidentData = {
      incident: {
        id: "i1",
        monitorId: "m1",
        status: "open",
        openedAt: new Date(),
        resolvedAt: null,
        reopenCount: 0,
        openingRunId: "r1",
        resolvingRunId: null,
        failureCode: "PAYMENT_IFRAME_MISSING",
        diagnosisJson: null,
        changeContextJson: "[]",
        monitor: {
          id: "m1",
          shopId: "s1",
          name: "Fixture checkout",
          productHandle: "test-product",
          productTitle: "Fixture",
          variantId: "1001",
          intervalMinutes: 60,
          enabled: true,
          nextRunAt: new Date(),
          runningAt: null,
          lastRunAt: new Date(),
          lastStatus: "failed",
          consecutiveFails: 2,
          consecutiveErrors: 0,
          openIncidentId: "i1",
          createdAt: new Date(),
        },
        diagnosis: {
          summary: "Payment step missing",
          probableCause: "Theme regression",
          recommendedAction: "Inspect checkout customization",
        },
        changes: [],
        openingRun: {
          id: "r1",
          monitorId: "m1",
          status: "failed",
          triggeredBy: "job:test",
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 500,
          stepTimingsJson: "[]",
          failureStep: "assert_payment_step",
          failureCode: "PAYMENT_IFRAME_MISSING",
          failureMessage: "missing",
          screenshotPath: null,
          consoleJson: "[]",
          failedRequestsJson: "[]",
          scriptOriginsJson: "[]",
          console: [{ level: "error", text: "payment failed" }],
          failedRequests: [],
        },
        deliveries: [],
        timeline: [],
      },
    };
    const incident = render(<IncidentDetailPage data={incidentData} />);
    expect(incident).toContain("AI diagnosis");
    expect(incident).toContain("Console evidence");
    expect(incident).toContain("Payment step missing");
  });
});

function render(node: React.ReactNode) {
  const router = createMemoryRouter(
    [{ path: "*", element: <AppProvider i18n={{}}>{node}</AppProvider> }],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}
