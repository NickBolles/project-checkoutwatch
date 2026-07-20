import type { PrismaClient } from "@prisma/client";
import {
  AlertDispatcher,
  incidentOpened,
  incidentResolved,
  monitorNeedsAttention,
  type AlertChannelAdapter,
  type AlertMessage,
  type AlertRoute,
  type ChannelType,
} from "@checkoutwatch/alerts";
import { canUseChannel, type PlanName } from "@checkoutwatch/core";
import { PrismaDeliveryLogStore, PrismaIncidentRepository } from "@checkoutwatch/db";

export type DispatchAlertPayload =
  | { event: "incident_opened"; incidentId: string }
  | { event: "incident_resolved"; incidentId: string }
  | { event: "monitor_attention"; monitorId: string; runId: string; autoPaused: boolean };

export function createDispatchAlertHandler(
  client: PrismaClient,
  adapters: readonly AlertChannelAdapter[],
  options: { mockOutboxDir?: string } = {},
) {
  const repository = new PrismaIncidentRepository(client);
  return async (payload: DispatchAlertPayload): Promise<void> => {
    const context =
      payload.event === "monitor_attention"
        ? await repository.monitorAttentionContext(payload.monitorId)
        : await repository.alertContext(payload.incidentId);
    const message = buildMessage(payload, context);
    const routes = context.routes.flatMap((route): AlertRoute[] => {
      if (!isChannel(route.channel)) return [];
      const entitled = canUseChannel(normalizePlan(context.plan), route.channel);
      const emailOnly = payload.event === "monitor_attention" && route.channel !== "email";
      const skipReason = context.uninstalled
        ? "shop uninstalled; consent withdrawn"
        : !entitled
          ? `plan ${normalizePlan(context.plan)} does not include ${route.channel}`
          : emailOnly
            ? "monitor attention notifications are email-only"
            : !route.enabled
              ? "channel is disabled"
              : undefined;
      return [
        {
          channel: route.channel,
          destination: route.destination,
          enabled: route.enabled && entitled && !emailOnly && !context.uninstalled,
          ...(skipReason ? { skipReason } : {}),
        },
      ];
    });
    const store = new PrismaDeliveryLogStore(
      client,
      context.shopId,
      "incidentId" in payload ? payload.incidentId : undefined,
    );
    await new AlertDispatcher(store, adapters, options).dispatch(message, routes);
  };
}

function buildMessage(
  payload: DispatchAlertPayload,
  context: { monitorName: string; storeUrl: string; diagnosisJson?: string },
): AlertMessage {
  const summary = diagnosisSummary(context.diagnosisJson);
  if (payload.event === "incident_opened")
    return incidentOpened({
      key: `incident:${payload.incidentId}:opened`,
      monitorName: context.monitorName,
      storeUrl: context.storeUrl,
      ...(summary ? { summary } : {}),
    });
  if (payload.event === "incident_resolved")
    return incidentResolved({
      key: `incident:${payload.incidentId}:resolved`,
      monitorName: context.monitorName,
      storeUrl: context.storeUrl,
      ...(summary ? { summary } : {}),
    });
  return monitorNeedsAttention({
    key: `monitor:${payload.monitorId}:product-unavailable:${payload.runId}`,
    monitorName: context.monitorName,
    storeUrl: context.storeUrl,
    autoPaused: payload.autoPaused,
  });
}

function diagnosisSummary(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      "summary" in parsed &&
      typeof parsed.summary === "string"
      ? parsed.summary
      : undefined;
  } catch {
    return undefined;
  }
}

function isChannel(value: string): value is ChannelType {
  return value === "email" || value === "slack" || value === "discord" || value === "sms";
}
function normalizePlan(value: string): PlanName {
  return value === "growth" || value === "pro" ? value : "free";
}
