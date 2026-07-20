import type { AlertChannelAdapter, DeliveryLogStore, DeliveryStatus, StatusEvent } from "./types.js";

const terminal = new Set<DeliveryStatus>(["delivered", "bounced", "failed", "skipped"]);

export interface ProviderDeliveryLookup {
  findByProviderMessageId(providerMessageId: string): Promise<{ id: string; status: DeliveryStatus } | null>;
}

export type StatusWebhookResult =
  | { accepted: true; event: StatusEvent; changed: boolean }
  | { accepted: false; reason: "unsupported" | "invalid_signature" | "invalid_payload" | "unknown_delivery" };

export async function ingestStatusWebhook(
  adapter: AlertChannelAdapter,
  store: DeliveryLogStore & ProviderDeliveryLookup,
  headers: Record<string, string>,
  rawBody: string,
): Promise<StatusWebhookResult> {
  if (!adapter.verifyStatusWebhook || !adapter.parseStatusEvent) {
    return { accepted: false, reason: "unsupported" };
  }
  if (!adapter.verifyStatusWebhook(headers, rawBody)) {
    return { accepted: false, reason: "invalid_signature" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    payload = Object.fromEntries(new URLSearchParams(rawBody));
  }
  const event = adapter.parseStatusEvent(payload);
  if (!event) return { accepted: false, reason: "invalid_payload" };
  const delivery = await store.findByProviderMessageId(event.providerMessageId);
  if (!delivery) return { accepted: false, reason: "unknown_delivery" };
  if (delivery.status === "delivered" || (terminal.has(delivery.status) && event.status === "deferred")) {
    return { accepted: true, event, changed: false };
  }
  await store.updateStatus(delivery.id, event.status, event.detail);
  return { accepted: true, event, changed: true };
}
