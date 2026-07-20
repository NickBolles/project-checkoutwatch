import type { AlertMessage } from "./types.js";

export interface IncidentTemplateInput {
  key: string;
  monitorName: string;
  storeUrl: string;
  summary?: string;
}

export function incidentOpened(input: IncidentTemplateInput): AlertMessage {
  const detail = input.summary ?? "The monitored checkout flow failed its verification.";
  return {
    key: input.key,
    event: "incident_opened",
    subject: `Checkout issue detected: ${input.monitorName}`,
    bodyText: `${detail}\nStore: ${input.storeUrl}`,
    bodyHtml: `<p>${escapeHtml(detail)}</p><p>Store: <a href="${escapeHtml(input.storeUrl)}">${escapeHtml(input.storeUrl)}</a></p>`,
  };
}

export function incidentResolved(input: IncidentTemplateInput): AlertMessage {
  const diagnosis = input.summary ? `\nLatest diagnosis: ${input.summary}` : "";
  return {
    key: input.key,
    event: "incident_resolved",
    subject: `Checkout recovered: ${input.monitorName}`,
    bodyText: `The monitored checkout flow is passing again.${diagnosis}\nStore: ${input.storeUrl}`,
    bodyHtml: `<p>The monitored checkout flow is passing again.</p>${input.summary ? `<p>Latest diagnosis: ${escapeHtml(input.summary)}</p>` : ""}<p>Store: <a href="${escapeHtml(input.storeUrl)}">${escapeHtml(input.storeUrl)}</a></p>`,
  };
}

export function testAlert(input: IncidentTemplateInput): AlertMessage {
  return {
    key: input.key,
    event: "test",
    subject: `CheckoutWatch test: ${input.monitorName}`,
    bodyText: `Your CheckoutWatch alert route works.\nStore: ${input.storeUrl}`,
    bodyHtml: `<p>Your CheckoutWatch alert route works.</p><p>Store: ${escapeHtml(input.storeUrl)}</p>`,
  };
}

export function monitorNeedsAttention(
  input: IncidentTemplateInput & { autoPaused?: boolean },
): AlertMessage {
  const detail = input.autoPaused
    ? "The monitored product remains unavailable, so this monitor was paused. Choose an available product before re-enabling it."
    : "The monitored product is unavailable. CheckoutWatch did not classify this as a checkout outage.";
  return {
    key: input.key,
    event: "monitor_attention",
    subject: `Monitor needs attention: ${input.monitorName}`,
    bodyText: `${detail}\nStore: ${input.storeUrl}`,
    bodyHtml: `<p>${escapeHtml(detail)}</p><p>Store: <a href="${escapeHtml(input.storeUrl)}">${escapeHtml(input.storeUrl)}</a></p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
