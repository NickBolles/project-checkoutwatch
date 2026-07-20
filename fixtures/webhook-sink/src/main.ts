import { startWebhookSink } from "./server.js";

const sink = await startWebhookSink(Number(process.env.WEBHOOK_SINK_PORT ?? 4700));
console.log(`Webhook sink listening at ${sink.url}`);
