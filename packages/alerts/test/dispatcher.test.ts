import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AlertDispatcher, type AlertChannelAdapter, type AlertMessage } from "../src/index.js";
import { MemoryDeliveryStore } from "./helpers.js";

const message: AlertMessage = { key: "incident:1:opened", event: "incident_opened", subject: "Broken", bodyText: "Checkout failed" };

describe("AlertDispatcher", () => {
  it("fans out, records skipped routes, and is idempotent", async () => {
    const store = new MemoryDeliveryStore();
    const email: AlertChannelAdapter = { type: "email", send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "email-1" }) };
    const slack: AlertChannelAdapter = { type: "slack", send: vi.fn().mockResolvedValue({ status: "delivered" }) };
    const dispatcher = new AlertDispatcher(store, [email, slack], { baseBackoffMs: 0 });
    const routes = [
      { channel: "email" as const, destination: "a@example.test" },
      { channel: "slack" as const, destination: "https://hooks.test/1" },
      { channel: "sms" as const, destination: "+15555550123", enabled: false },
    ];
    await Promise.all([dispatcher.dispatch(message, routes), dispatcher.dispatch(message, routes)]);
    expect(store.entries).toHaveLength(3);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(slack.send).toHaveBeenCalledTimes(1);
    expect(store.entries.map((entry) => entry.status).sort()).toEqual(["delivered", "sent", "skipped"]);
  });

  it("retries three times then records failure", async () => {
    const store = new MemoryDeliveryStore();
    const adapter: AlertChannelAdapter = { type: "email", send: vi.fn().mockResolvedValue({ status: "failed", error: "offline" }) };
    const sleep = vi.fn().mockResolvedValue(undefined);
    await new AlertDispatcher(store, [adapter], { sleep }).dispatch(message, [{ channel: "email", destination: "x@example.test" }]);
    expect(adapter.send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(store.entries[0]?.status).toBe("failed");
  });

  it("routes mock:// through the mock adapter under real transport", async () => {
    const outbox = await mkdtemp(join(tmpdir(), "checkoutwatch-alerts-"));
    const real = { type: "email", send: vi.fn() } satisfies AlertChannelAdapter;
    const store = new MemoryDeliveryStore();
    await new AlertDispatcher(store, [real], { mockOutboxDir: outbox }).dispatch(message, [{ channel: "email", destination: "mock://merchant" }]);
    expect(real.send).not.toHaveBeenCalled();
    expect(await readFile(join(outbox, "email.jsonl"), "utf8")).toContain(message.key);
    expect(store.entries[0]?.status).toBe("delivered");
  });
});
