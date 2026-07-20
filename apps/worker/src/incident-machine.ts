export interface ResolvedIncidentState {
  id: string;
  resolvedAt: Date;
}

export interface IncidentMonitorState {
  consecutiveFails: number;
  consecutiveErrors: number;
  consecutiveProductUnavailable: number;
  openIncidentId?: string;
  recentlyResolved?: ResolvedIncidentState;
  enabled: boolean;
}

export interface IncidentRunResult {
  status: "passed" | "failed" | "error";
  failureCode?: string;
}

export type IncidentAction =
  | { type: "scheduleRecheck"; delayMs: number }
  | { type: "openIncident" }
  | { type: "reopenIncident"; incidentId: string }
  | { type: "resolveIncident"; incidentId: string }
  | { type: "flagMonitorAttention"; autoPause: boolean }
  | { type: "opsFlag"; consecutiveErrors: number };

export interface IncidentTransitionOptions {
  now?: Date;
  recheckDelayMs?: number;
  reopenCooldownMs?: number;
  productUnavailableAutopause?: number;
}

export interface IncidentTransition {
  state: IncidentMonitorState;
  actions: IncidentAction[];
}

export function transitionIncident(
  current: IncidentMonitorState,
  run: IncidentRunResult,
  options: IncidentTransitionOptions = {},
): IncidentTransition {
  const now = options.now ?? new Date();
  const recheckDelayMs = options.recheckDelayMs ?? 90_000;
  const reopenCooldownMs = options.reopenCooldownMs ?? 30 * 60_000;
  const autopause = options.productUnavailableAutopause ?? 6;
  const state: IncidentMonitorState = { ...current };
  const actions: IncidentAction[] = [];

  if (run.status === "error") {
    state.consecutiveErrors += 1;
    if (state.consecutiveErrors === 3) actions.push({ type: "opsFlag", consecutiveErrors: 3 });
    return { state, actions };
  }

  if (run.status === "passed") {
    state.consecutiveFails = 0;
    state.consecutiveErrors = 0;
    state.consecutiveProductUnavailable = 0;
    if (state.openIncidentId)
      actions.push({ type: "resolveIncident", incidentId: state.openIncidentId });
    return { state, actions };
  }

  state.consecutiveFails += 1;
  state.consecutiveErrors = 0;
  if (run.failureCode === "PRODUCT_UNAVAILABLE") {
    state.consecutiveProductUnavailable += 1;
    if (state.consecutiveProductUnavailable === 1)
      actions.push({ type: "scheduleRecheck", delayMs: recheckDelayMs });
    if (state.consecutiveProductUnavailable === 2)
      actions.push({ type: "flagMonitorAttention", autoPause: false });
    if (state.consecutiveProductUnavailable === autopause) {
      state.enabled = false;
      actions.push({ type: "flagMonitorAttention", autoPause: true });
    }
    return { state, actions };
  }

  state.consecutiveProductUnavailable = 0;
  if (state.openIncidentId) return { state, actions };
  if (state.consecutiveFails === 1) {
    actions.push({ type: "scheduleRecheck", delayMs: recheckDelayMs });
    return { state, actions };
  }
  if (
    current.recentlyResolved &&
    now.getTime() - current.recentlyResolved.resolvedAt.getTime() < reopenCooldownMs
  ) {
    actions.push({ type: "reopenIncident", incidentId: current.recentlyResolved.id });
  } else {
    actions.push({ type: "openIncident" });
  }
  return { state, actions };
}
