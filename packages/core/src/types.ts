export const RUN_STATUSES = ["passed", "failed", "error", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TRIGGER_TYPES = ["schedule", "manual", "recheck"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CHANNEL_TYPES = ["email", "slack", "discord", "sms"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const PLAN_NAMES = ["free", "growth", "pro"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export type JsonObject = Record<string, unknown>;
