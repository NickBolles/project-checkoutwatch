export type ChannelType = "email" | "slack" | "discord" | "sms";

export type DeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "deferred"
  | "failed"
  | "skipped";

export interface AlertMessage {
  key: string;
  event: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  meta?: Record<string, unknown>;
}

export interface DeliveryResult {
  status: "sent" | "delivered" | "failed";
  providerMessageId?: string;
  error?: string;
}

export interface StatusEvent {
  providerMessageId: string;
  status: DeliveryStatus;
  detail?: string;
}

export interface AlertChannelAdapter {
  readonly type: ChannelType;
  send(destination: string, message: AlertMessage): Promise<DeliveryResult>;
  verifyStatusWebhook?(headers: Record<string, string>, rawBody: string): boolean;
  parseStatusEvent?(payload: unknown): StatusEvent | null;
}

export interface DeliveryLogEntry {
  id: string;
  messageKey: string;
  event: string;
  channelType: ChannelType;
  destination: string;
  status: DeliveryStatus;
  providerMessageId?: string;
  detail?: string;
  attempts: number;
  createdAt?: Date;
  updatedAt?: Date;
  meta?: Record<string, unknown>;
}

export type NewDeliveryLogEntry = Omit<DeliveryLogEntry, "id" | "createdAt" | "updatedAt">;

export interface DeliveryLogStore {
  record(entry: NewDeliveryLogEntry): Promise<string>;
  claimQueued(limit: number): Promise<DeliveryLogEntry[]>;
  transition(
    id: string,
    from: DeliveryStatus,
    to: DeliveryStatus,
    detail?: string,
  ): Promise<boolean>;
  updateStatus(id: string, status: DeliveryStatus, detail?: string): Promise<void>;
}

export interface AlertRoute {
  channel: ChannelType;
  destination: string;
  enabled?: boolean;
  skipReason?: string;
}
