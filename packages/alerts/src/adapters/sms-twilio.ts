import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AlertChannelAdapter,
  AlertMessage,
  DeliveryResult,
  DeliveryStatus,
  StatusEvent,
} from "../types.js";
import type { Fetch } from "./http.js";

export interface TwilioSmsOptions {
  accountSid: string;
  authToken: string;
  from: string;
  fetchImpl?: Fetch;
  endpoint?: string;
}

const twilioStatuses: Record<string, DeliveryStatus> = {
  queued: "queued",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
};

export class TwilioSmsAdapter implements AlertChannelAdapter {
  readonly type = "sms" as const;
  private readonly fetchImpl: Fetch;
  private readonly endpoint: string;

  constructor(private readonly options: TwilioSmsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint =
      options.endpoint ??
      `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`;
  }

  async send(destination: string, message: AlertMessage): Promise<DeliveryResult> {
    const body = new URLSearchParams({
      To: destination,
      From: this.options.from,
      Body: `${message.subject}: ${message.bodyText}`,
    });
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const payload: unknown = await response.json();
      if (!response.ok) return { status: "failed", error: `HTTP ${response.status}` };
      const sid = isObject(payload) && typeof payload.sid === "string" ? payload.sid : undefined;
      return { status: "sent", ...(sid ? { providerMessageId: sid } : {}) };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  verifyStatusWebhook(headers: Record<string, string>, rawBody: string): boolean {
    const supplied = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "x-twilio-signature",
    )?.[1];
    if (!supplied) return false;
    const url = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "x-checkoutwatch-webhook-url",
    )?.[1];
    if (!url) return false;
    const params = new URLSearchParams(rawBody);
    const signaturePayload = [...params.keys()]
      .sort()
      .map((key) => `${key}${params.get(key) ?? ""}`)
      .join("");
    const expected = createHmac("sha1", this.options.authToken)
      .update(`${url}${signaturePayload}`)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseStatusEvent(payload: unknown): StatusEvent | null {
    if (!isObject(payload)) return null;
    const providerMessageId = stringField(payload, "MessageSid") ?? stringField(payload, "SmsSid");
    const rawStatus = stringField(payload, "MessageStatus") ?? stringField(payload, "SmsStatus");
    const status = rawStatus ? twilioStatuses[rawStatus.toLowerCase()] : undefined;
    if (!providerMessageId || !status) return null;
    const detail = stringField(payload, "ErrorMessage") ?? stringField(payload, "ErrorCode");
    return { providerMessageId, status, ...(detail ? { detail } : {}) };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}
