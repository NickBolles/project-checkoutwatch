import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebhookSink } from "@checkoutwatch/webhook-sink";
import {
  DiscordWebhookAdapter,
  MockAdapter,
  ResendEmailAdapter,
  SlackWebhookAdapter,
  TwilioSmsAdapter,
  type AlertMessage,
} from "../src/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const message: AlertMessage = { key: "test:adapter", event: "test", subject: "Test alert", bodyText: "It works" };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => Promise.all(closers.splice(0).map((close) => close())));

describe("webhook adapters", () => {
  it("send Slack and Discord payloads to the local sink", async () => {
    const sink = await startWebhookSink();
    closers.push(() => sink.close());
    const slack = new SlackWebhookAdapter();
    const discord = new DiscordWebhookAdapter();
    expect(await slack.send(`${sink.url}/slack`, message)).toMatchObject({ status: "delivered" });
    expect(await discord.send(`${sink.url}/discord`, message)).toMatchObject({ status: "delivered" });
    expect(sink.requests).toHaveLength(2);
    expect(sink.requests[0]?.body).toMatchObject({ text: expect.stringContaining("Test alert"), blocks: expect.any(Array) });
    expect(sink.requests[1]?.body).toMatchObject({ content: "It works", embeds: expect.any(Array) });
  });
});

describe("MockAdapter", () => {
  it("satisfies the send contract for every channel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alert-contract-"));
    for (const type of ["email", "slack", "discord", "sms"] as const) {
      const result = await new MockAdapter(type, directory).send("mock://test", message);
      expect(result.status).toBe("delivered");
      expect(result.providerMessageId).toBeTruthy();
    }
  });
});

describe("ResendEmailAdapter", () => {
  it("sends the expected request and verifies/parses callbacks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const secret = `whsec_${Buffer.from("secret").toString("base64")}`;
    const adapter = new ResendEmailAdapter({ apiKey: "test-key", from: "alerts@example.test", webhookSecret: secret, fetchImpl });
    const result = await adapter.send("merchant@example.test", message);
    expect(result).toEqual({ status: "sent", providerMessageId: "re_1" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-key", "idempotency-key": message.key }) }));
    const raw = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
    const signature = createHmac("sha256", "secret").update(`evt.123.${raw}`).digest("base64");
    expect(adapter.verifyStatusWebhook({ "svix-id": "evt", "svix-timestamp": "123", "svix-signature": `v1 ${signature}` }, raw)).toBe(true);
    expect(adapter.verifyStatusWebhook({ "svix-id": "evt", "svix-timestamp": "123", "svix-signature": "v1 bad" }, raw)).toBe(false);
    expect(adapter.parseStatusEvent(JSON.parse(raw))).toEqual({ providerMessageId: "re_1", status: "delivered" });
  });
});

describe("TwilioSmsAdapter", () => {
  it("sends form data and verifies/parses callbacks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const adapter = new TwilioSmsAdapter({ accountSid: "AC1", authToken: "token", from: "+15550000000", fetchImpl });
    expect(await adapter.send("+15551111111", message)).toEqual({ status: "sent", providerMessageId: "SM1" });
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(URLSearchParams);
    if (!(request?.body instanceof URLSearchParams)) throw new Error("expected URLSearchParams");
    expect(request.body.toString()).toContain("To=%2B15551111111");
    const raw = "MessageSid=SM1&MessageStatus=delivered";
    const signature = createHmac("sha256", "token").update(raw).digest("base64");
    expect(adapter.verifyStatusWebhook({ "x-twilio-signature": signature }, raw)).toBe(true);
    expect(adapter.verifyStatusWebhook({ "x-twilio-signature": "bad" }, raw)).toBe(false);
    expect(adapter.parseStatusEvent(Object.fromEntries(new URLSearchParams(raw)))).toEqual({ providerMessageId: "SM1", status: "delivered" });
  });
});
