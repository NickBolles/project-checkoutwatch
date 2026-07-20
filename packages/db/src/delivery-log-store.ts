import type { PrismaClient } from "@prisma/client";
import type {
  ChannelType,
  DeliveryLogEntry,
  DeliveryLogStore,
  DeliveryStatus,
  NewDeliveryLogEntry,
  ProviderDeliveryLookup,
} from "@checkoutwatch/alerts";

export class PrismaDeliveryLogStore implements DeliveryLogStore, ProviderDeliveryLookup {
  constructor(
    private readonly client: PrismaClient,
    private readonly shopId: string,
    private readonly incidentId?: string,
  ) {}

  async record(entry: NewDeliveryLogEntry): Promise<string> {
    const row = await this.client.alertDelivery.upsert({
      where: {
        messageKey_channelType_destination: {
          messageKey: entry.messageKey,
          channelType: entry.channelType,
          destination: entry.destination,
        },
      },
      update: {},
      create: {
        shopId: this.shopId,
        ...(this.incidentId ? { incidentId: this.incidentId } : {}),
        messageKey: entry.messageKey,
        event: entry.event,
        channelType: entry.channelType,
        destination: entry.destination,
        status: entry.status,
        attempts: entry.attempts,
        ...(entry.detail ? { errorDetail: entry.detail } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  async claimQueued(limit: number): Promise<DeliveryLogEntry[]> {
    return this.client.$transaction(async (transaction) => {
      const candidates = await transaction.alertDelivery.findMany({
        where: { shopId: this.shopId, status: "queued" },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      const claimed: DeliveryLogEntry[] = [];
      for (const row of candidates) {
        const result = await transaction.alertDelivery.updateMany({
          where: { id: row.id, status: "queued" },
          data: { status: "sending", attempts: { increment: 1 } },
        });
        if (result.count === 1) claimed.push(toEntry({ ...row, status: "sending", attempts: row.attempts + 1 }));
      }
      return claimed;
    });
  }

  async transition(
    id: string,
    from: DeliveryStatus,
    to: DeliveryStatus,
    detail?: string,
  ): Promise<boolean> {
    const parsed = parseTransitionDetail(detail);
    const result = await this.client.alertDelivery.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(from === "queued" && to === "sending" ? { attempts: { increment: 1 } } : {}),
        ...(parsed.providerMessageId ? { providerMessageId: parsed.providerMessageId } : {}),
        ...(parsed.error ? { errorDetail: parsed.error } : detail ? { errorDetail: detail } : {}),
      },
    });
    return result.count === 1;
  }

  async updateStatus(id: string, status: DeliveryStatus, detail?: string): Promise<void> {
    await this.client.alertDelivery.update({
      where: { id },
      data: { status, ...(detail ? { errorDetail: detail } : {}) },
    });
  }

  async findByProviderMessageId(providerMessageId: string): Promise<{ id: string; status: DeliveryStatus } | null> {
    const row = await this.client.alertDelivery.findFirst({
      where: { providerMessageId },
      select: { id: true, status: true },
    });
    return row ? { id: row.id, status: row.status as DeliveryStatus } : null;
  }
}

function toEntry(row: {
  id: string;
  messageKey: string;
  event: string;
  channelType: string;
  destination: string;
  status: string;
  providerMessageId: string | null;
  errorDetail: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryLogEntry {
  return {
    id: row.id,
    messageKey: row.messageKey,
    event: row.event,
    channelType: row.channelType as ChannelType,
    destination: row.destination,
    status: row.status as DeliveryStatus,
    ...(row.providerMessageId ? { providerMessageId: row.providerMessageId } : {}),
    ...(row.errorDetail ? { detail: row.errorDetail } : {}),
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseTransitionDetail(detail?: string): { providerMessageId?: string; error?: string } {
  if (!detail) return {};
  try {
    const value = JSON.parse(detail) as unknown;
    if (typeof value !== "object" || value === null) return { error: detail };
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.providerMessageId === "string" ? { providerMessageId: record.providerMessageId } : {}),
      ...(typeof record.error === "string" ? { error: record.error } : {}),
    };
  } catch {
    return { error: detail };
  }
}
