import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("monitors/new", "routes/app.monitors.new.tsx"),
    route("monitors/:id", "routes/app.monitors.$id.tsx"),
    route("incidents/:id", "routes/app.incidents.$id.tsx"),
    route("settings", "routes/app.settings.tsx"),
    route("settings/alerts", "routes/app.settings.alerts.tsx"),
    route("settings/status-page", "routes/app.settings.status-page.tsx"),
    route("billing", "routes/app.billing.tsx"),
  ]),
  route("artifacts/:runId/:file", "routes/artifacts.$runId.$file.ts"),
  route("status/:slug", "routes/status.$slug.tsx"),
  route("healthz", "routes/healthz.ts"),
  route("webhooks/app/uninstalled", "routes/webhooks.app_uninstalled.ts"),
  route("webhooks/customers/data_request", "routes/webhooks.customers_data_request.ts"),
  route("webhooks/customers/redact", "routes/webhooks.customers_redact.ts"),
  route("webhooks/shop/redact", "routes/webhooks.shop_redact.ts"),
  route("webhooks/resend", "routes/webhooks.resend.ts"),
  route("webhooks/twilio", "routes/webhooks.twilio.ts"),
  route("webhooks/app_subscriptions/update", "routes/webhooks.app_subscriptions_update.ts"),
] satisfies RouteConfig;
