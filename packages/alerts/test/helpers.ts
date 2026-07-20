import type {
  DeliveryLogEntry,
  DeliveryLogStore,
  DeliveryStatus,
  NewDeliveryLogEntry,
  ProviderDeliveryLookup,
} from "../src/index.js";

export class MemoryDeliveryStore implements DeliveryLogStore, ProviderDeliveryLookup {
  readonly entries: DeliveryLogEntry[] = [];
  private nextId = 1;

  async record(entry: NewDeliveryLogEntry): Promise<string> {
    const existing = this.entries.find(
      (item) =>
        item.messageKey === entry.messageKey &&
        item.channelType === entry.channelType &&
        item.destination === entry.destination,
    );
    if (existing) return existing.id;
    const id = String(this.nextId++);
    this.entries.push({ id, ...entry });
    return id;
  }

  async claimQueued(limit: number): Promise<DeliveryLogEntry[]> {
    const queued = this.entries.filter((entry) => entry.status === "queued").slice(0, limit);
    for (const entry of queued) {
      entry.status = "sending";
      entry.attempts += 1;
    }
    return queued.map((entry) => ({ ...entry }));
  }

  async transition(id: string, from: DeliveryStatus, to: DeliveryStatus, detail?: string): Promise<boolean> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || entry.status !== from) return false;
    entry.status = to;
    if (from === "queued" && to === "sending") entry.attempts += 1;
    if (detail) {
      entry.detail = detail;
      try {
        const parsed = JSON.parse(detail) as Record<string, unknown>;
        if (typeof parsed.providerMessageId === "string") entry.providerMessageId = parsed.providerMessageId;
      } catch {
        // Plain-text details are valid when no provider id was returned.
      }
    }
    return true;
  }

  async updateStatus(id: string, status: DeliveryStatus, detail?: string): Promise<void> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) throw new Error("delivery not found");
    entry.status = status;
    if (detail) entry.detail = detail;
  }

  async findByProviderMessageId(providerMessageId: string) {
    const entry = this.entries.find((item) => item.providerMessageId === providerMessageId);
    return entry ? { id: entry.id, status: entry.status } : null;
  }
}
