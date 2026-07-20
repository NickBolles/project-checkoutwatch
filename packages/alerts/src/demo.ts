import { startWebhookSink } from "@checkoutwatch/webhook-sink";
import { AlertDispatcher, MockAdapter, SlackWebhookAdapter, testAlert } from "./index.js";
import type { DeliveryLogEntry, DeliveryLogStore, DeliveryStatus, NewDeliveryLogEntry } from "./types.js";

const rows: DeliveryLogEntry[] = [];
const store: DeliveryLogStore = {
  record(entry: NewDeliveryLogEntry) {
    const found = rows.find((row) => row.messageKey === entry.messageKey && row.channelType === entry.channelType && row.destination === entry.destination);
    if (found) return Promise.resolve(found.id);
    const id = String(rows.length + 1);
    rows.push({ id, ...entry });
    return Promise.resolve(id);
  },
  claimQueued(limit: number) {
    return Promise.resolve(rows.filter((row) => row.status === "queued").slice(0, limit));
  },
  transition(id: string, from: DeliveryStatus, to: DeliveryStatus, detail?: string) {
    const row = rows.find((candidate) => candidate.id === id && candidate.status === from);
    if (!row) return Promise.resolve(false);
    row.status = to;
    if (detail) row.detail = detail;
    return Promise.resolve(true);
  },
  updateStatus(id: string, status: DeliveryStatus, detail?: string) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error("not found");
    row.status = status;
    if (detail) row.detail = detail;
    return Promise.resolve();
  },
};

const sink = await startWebhookSink();
try {
  const dispatcher = new AlertDispatcher(store, [new MockAdapter("email"), new SlackWebhookAdapter()]);
  await dispatcher.dispatch(
    testAlert({ key: `demo:${Date.now()}`, monitorName: "Demo checkout", storeUrl: "http://localhost:4600" }),
    [
      { channel: "email", destination: "mock://demo@example.test" },
      { channel: "slack", destination: `${sink.url}/slack` },
    ],
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sink.close();
}
