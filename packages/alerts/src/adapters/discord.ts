import type { AlertChannelAdapter, AlertMessage, DeliveryResult } from "../types.js";
import { postJson, type Fetch } from "./http.js";

export class DiscordWebhookAdapter implements AlertChannelAdapter {
  readonly type = "discord" as const;
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async send(destination: string, message: AlertMessage): Promise<DeliveryResult> {
    const { result } = await postJson(this.fetchImpl, destination, {
      content: message.bodyText,
      embeds: [{ title: message.subject, description: message.bodyText }],
    });
    return result;
  }
}
