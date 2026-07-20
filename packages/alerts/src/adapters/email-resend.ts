import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AlertChannelAdapter,
  AlertMessage,
  DeliveryResult,
  DeliveryStatus,
  StatusEvent,
} from "../types.js";
import { postJson, type Fetch } from "./http.js";

export interface ResendEmailOptions {
  apiKey: string;
  from: string;
  webhookSecret?: string;
  fetchImpl?: Fetch;
  endpoint?: string;
}

const resendStatuses: Record<string, DeliveryStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.delivery_delayed": "deferred",
  "email.failed": "failed",
};

export class ResendEmailAdapter implements AlertChannelAdapter {
  readonly type = "email" as const;
  private readonly fetchImpl: Fetch;
  private readonly endpoint: string;

  constructor(private readonly options: ResendEmailOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.resend.com/emails";
  }

  async send(destination: string, message: AlertMessage): Promise<DeliveryResult> {
    const { result, payload } = await postJson(
      this.fetchImpl,
      this.endpoint,
      {
        from: this.options.from,
        to: [destination],
        subject: message.subject,
        text: message.bodyText,
        ...(message.bodyHtml ? { html: message.bodyHtml } : {}),
      },
      { authorization: `Bearer ${this.options.apiKey}`, "idempotency-key": message.key },
    );
    if (result.status === "failed") return result;
    const id = objectString(payload, "id");
    return { status: "sent", ...(id ? { providerMessageId: id } : {}) };
  }

  verifyStatusWebhook(headers: Record<string, string>, rawBody: string): boolean {
    if (!this.options.webhookSecret) return false;
    const id = header(headers, "svix-id");
    const timestamp = header(headers, "svix-timestamp");
    const supplied = header(headers, "svix-signature")?.split(" ").at(-1);
    if (!id || !timestamp || !supplied) return false;
    const secret = this.options.webhookSecret.startsWith("whsec_")
      ? Buffer.from(this.options.webhookSecret.slice(6), "base64")
      : Buffer.from(this.options.webhookSecret);
    const expected = createHmac("sha256", secret)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest("base64");
    return safeEqual(expected, supplied);
  }

  parseStatusEvent(payload: unknown): StatusEvent | null {
    if (!isObject(payload)) return null;
    const type = objectString(payload, "type");
    const data = payload.data;
    if (!type || !isObject(data)) return null;
    const providerMessageId = objectString(data, "email_id") ?? objectString(data, "id");
    const status = resendStatuses[type];
    if (!providerMessageId || !status) return null;
    return { providerMessageId, status };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objectString(value: unknown, key: string): string | undefined {
  return isObject(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1];
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
