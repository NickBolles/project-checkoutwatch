import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AlertChannelAdapter, AlertMessage, ChannelType, DeliveryResult } from "../types.js";

export class MockAdapter implements AlertChannelAdapter {
  constructor(
    readonly type: ChannelType,
    private readonly outboxDir = "var/outbox",
  ) {}

  async send(destination: string, message: AlertMessage): Promise<DeliveryResult> {
    const path = join(this.outboxDir, `${this.type}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    const providerMessageId = `mock-${message.key}-${this.type}-${Date.now()}`;
    await appendFile(
      path,
      `${JSON.stringify({ providerMessageId, destination, message, sentAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    return { status: "delivered", providerMessageId };
  }
}
