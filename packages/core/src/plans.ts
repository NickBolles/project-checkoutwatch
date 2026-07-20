import type { ChannelType, PlanName } from "./types.js";

export interface PlanEntitlements {
  readonly maxMonitors: number;
  readonly minIntervalMinutes: number;
  readonly channels: readonly ChannelType[];
  readonly aiDiagnosis: boolean;
  readonly publicStatusPage: boolean;
}

// PLAN_REVIEW minor #1 resolves the source-plan contradiction intentionally:
// Growth gets email/chat channels; SMS remains Pro-only because it has direct costs/compliance.
export const PLAN_ENTITLEMENTS = {
  free: {
    maxMonitors: 1,
    minIntervalMinutes: 60,
    channels: ["email"],
    aiDiagnosis: false,
    publicStatusPage: false,
  },
  growth: {
    maxMonitors: 3,
    minIntervalMinutes: 10,
    channels: ["email", "slack", "discord"],
    aiDiagnosis: true,
    publicStatusPage: false,
  },
  pro: {
    maxMonitors: 10,
    minIntervalMinutes: 5,
    channels: ["email", "slack", "discord", "sms"],
    aiDiagnosis: true,
    publicStatusPage: true,
  },
} as const satisfies Record<PlanName, PlanEntitlements>;

export function clampInterval(plan: PlanName, requestedMinutes: number): number {
  if (!Number.isFinite(requestedMinutes)) {
    return PLAN_ENTITLEMENTS[plan].minIntervalMinutes;
  }

  return Math.max(Math.trunc(requestedMinutes), PLAN_ENTITLEMENTS[plan].minIntervalMinutes);
}

export function canUseChannel(plan: PlanName, channel: ChannelType): boolean {
  return (PLAN_ENTITLEMENTS[plan].channels as readonly ChannelType[]).includes(channel);
}

export function maxMonitors(plan: PlanName): number {
  return PLAN_ENTITLEMENTS[plan].maxMonitors;
}
