import type { PrismaClient } from "@prisma/client";
import {
  PLAN_ENTITLEMENTS,
  canUseChannel,
  clampInterval,
  type PlanName,
} from "@checkoutwatch/core";

export interface ReconcilePlanPayload {
  shopId: string;
  previousPlan?: PlanName;
}

export function createReconcilePlanHandler(client: PrismaClient) {
  return async ({ shopId, previousPlan }: ReconcilePlanPayload) => {
    const shop = await client.shop.findUniqueOrThrow({
      where: { id: shopId },
      include: { monitors: { orderBy: { createdAt: "desc" } }, channels: true, statusPage: true },
    });
    const plan = normalizePlan(shop.plan);
    const entitlement = PLAN_ENTITLEMENTS[plan];
    const enabled = shop.monitors.filter((monitor) => monitor.enabled);
    const paused = enabled.slice(0, Math.max(0, enabled.length - entitlement.maxMonitors));
    const intervalAdjustments = shop.monitors.filter(
      (monitor) => monitor.intervalMinutes < entitlement.minIntervalMinutes,
    );
    const disabledChannels = shop.channels.filter(
      (channel) => channel.enabled && isChannel(channel.type) && !canUseChannel(plan, channel.type),
    );
    const disableStatusPage = Boolean(shop.statusPage?.enabled && !entitlement.publicStatusPage);
    await client.$transaction(async (transaction) => {
      if (paused.length)
        await transaction.monitor.updateMany({
          where: { id: { in: paused.map((monitor) => monitor.id) } },
          data: { enabled: false, runningAt: null },
        });
      for (const monitor of intervalAdjustments)
        await transaction.monitor.update({
          where: { id: monitor.id },
          data: { intervalMinutes: clampInterval(plan, monitor.intervalMinutes) },
        });
      if (disabledChannels.length)
        await transaction.alertChannelConfig.updateMany({
          where: { id: { in: disabledChannels.map((channel) => channel.id) } },
          data: { enabled: false },
        });
      if (disableStatusPage)
        await transaction.statusPage.update({
          where: { shopId: shop.id },
          data: { enabled: false },
        });
      const summary = {
        previousPlan: previousPlan ?? null,
        plan,
        pausedMonitors: paused.map((monitor) => ({ id: monitor.id, name: monitor.name })),
        intervalAdjustments: intervalAdjustments.length,
        disabledChannels: disabledChannels.map((channel) => channel.type),
        statusPageDisabled: disableStatusPage,
        reconciledAt: new Date().toISOString(),
      };
      await transaction.shop.update({
        where: { id: shopId },
        data: { reconciliationJson: JSON.stringify(summary) },
      });
      const logs = [
        ...paused.map((monitor) => ({
          feature: "monitor",
          reason: `disabled after downgrade to ${plan}: monitor limit is ${entitlement.maxMonitors}`,
          metadataJson: JSON.stringify({ monitorId: monitor.id }),
        })),
        ...intervalAdjustments.map((monitor) => ({
          feature: "interval",
          action: "clamped",
          reason: `clamped after plan change to ${entitlement.minIntervalMinutes} minutes`,
          metadataJson: JSON.stringify({
            monitorId: monitor.id,
            requested: monitor.intervalMinutes,
          }),
        })),
        ...disabledChannels.map((channel) => ({
          feature: `channel:${channel.type}`,
          reason: `disabled after downgrade: ${channel.type} is not included in ${plan}`,
          metadataJson: JSON.stringify({ channelId: channel.id }),
        })),
        ...(disableStatusPage
          ? [
              {
                feature: "public_status_page",
                reason: `disabled after downgrade: public status pages require Pro`,
                metadataJson: JSON.stringify({ statusPageId: shop.statusPage?.id }),
              },
            ]
          : []),
      ];
      if (logs.length)
        await transaction.entitlementLog.createMany({
          data: logs.map((log) => ({ shopId, action: "skipped", ...log })),
        });
    });
  };
}

function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}
function isChannel(value: string): value is "email" | "slack" | "discord" | "sms" {
  return value === "email" || value === "slack" || value === "discord" || value === "sms";
}
