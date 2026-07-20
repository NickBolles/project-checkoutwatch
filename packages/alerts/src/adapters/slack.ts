import type { AlertChannelAdapter, AlertMessage, DeliveryResult } from "../types.js";
import { postJson, type Fetch } from "./http.js";

export class SlackWebhookAdapter implements AlertChannelAdapter {
  readonly type = "slack" as const;
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async send(destination: string, message: AlertMessage): Promise<DeliveryResult> {
    const { result } = await postJson(this.fetchImpl, destination, {
      text: `*${message.subject}*\n${message.bodyText}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: message.subject } },
        { type: "section", text: { type: "mrkdwn", text: message.bodyText } },
      ],
    });
    return result;
  }
}
