import { describe, expect, it } from "vitest";
import { ingestStatusWebhook, type AlertChannelAdapter } from "../src/index.js";
import { MemoryDeliveryStore } from "./helpers.js";

describe("provider status pipeline", () => {
  it("advances delivery and never regresses delivered", async () => {
    const store = new MemoryDeliveryStore();
    const id = await store.record({ messageKey: "k", event: "test", channelType: "email", destination: "x", status: "queued", attempts: 0 });
    await store.transition(id, "queued", "sending");
    await store.transition(id, "sending", "sent", JSON.stringify({ providerMessageId: "provider-1" }));
    const adapter: AlertChannelAdapter = {
      type: "email",
      async send() { return { status: "sent" }; },
      verifyStatusWebhook(headers) { return headers.authorization === "good"; },
      parseStatusEvent(payload) {
        const value = payload as { status: "delivered" | "bounced" };
        return { providerMessageId: "provider-1", status: value.status };
      },
    };
    expect(await ingestStatusWebhook(adapter, store, { authorization: "bad" }, '{"status":"delivered"}')).toEqual({ accepted: false, reason: "invalid_signature" });
    expect((await ingestStatusWebhook(adapter, store, { authorization: "good" }, '{"status":"delivered"}'))).toMatchObject({ accepted: true, changed: true });
    expect(store.entries[0]?.status).toBe("delivered");
    expect((await ingestStatusWebhook(adapter, store, { authorization: "good" }, '{"status":"bounced"}'))).toMatchObject({ accepted: true, changed: false });
    expect(store.entries[0]?.status).toBe("delivered");
  });
});
