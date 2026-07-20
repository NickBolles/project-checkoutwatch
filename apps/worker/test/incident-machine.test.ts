import { describe, expect, it } from "vitest";
import {
  transitionIncident,
  type IncidentMonitorState,
  type IncidentRunResult,
} from "../src/incident-machine.js";

const base: IncidentMonitorState = {
  consecutiveFails: 0,
  consecutiveErrors: 0,
  consecutiveProductUnavailable: 0,
  enabled: true,
};

describe("pure incident state machine", () => {
  it.each([
    {
      name: "first failure schedules recheck",
      state: base,
      run: failed("CHECKOUT_HTTP_5XX"),
      actions: ["scheduleRecheck"],
      fails: 1,
    },
    {
      name: "confirming failure opens",
      state: { ...base, consecutiveFails: 1 },
      run: failed("PAYMENT_IFRAME_MISSING"),
      actions: ["openIncident"],
      fails: 2,
    },
    {
      name: "pass resolves open incident",
      state: { ...base, consecutiveFails: 2, openIncidentId: "i1" },
      run: { status: "passed" },
      actions: ["resolveIncident"],
      fails: 0,
    },
    {
      name: "pass resets counters",
      state: { ...base, consecutiveFails: 1, consecutiveErrors: 2 },
      run: { status: "passed" },
      actions: [],
      fails: 0,
    },
  ] satisfies Array<{
    name: string;
    state: IncidentMonitorState;
    run: IncidentRunResult;
    actions: string[];
    fails: number;
  }>)("$name", ({ state, run, actions, fails }) => {
    const result = transitionIncident(state, run);
    expect(result.actions.map((action) => action.type)).toEqual(actions);
    expect(result.state.consecutiveFails).toBe(fails);
  });

  it("errors never page and never reset a failure streak, but ops-flag exactly at three", () => {
    let state = { ...base, consecutiveFails: 1 };
    state = transitionIncident(state, { status: "error", failureCode: "BROWSER_ERROR" }).state;
    expect(state.consecutiveFails).toBe(1);
    expect(state.consecutiveErrors).toBe(1);
    state = transitionIncident(state, { status: "error" }).state;
    const third = transitionIncident(state, { status: "error" });
    expect(third.actions).toEqual([{ type: "opsFlag", consecutiveErrors: 3 }]);
    expect(transitionIncident(third.state, { status: "error" }).actions).toEqual([]);
  });

  it("an error interleaved in a failure streak does not block the confirming open", () => {
    const first = transitionIncident(base, failed("CHECKOUT_HTTP_5XX"));
    const error = transitionIncident(first.state, {
      status: "error",
      failureCode: "BROWSER_ERROR",
    });
    expect(error.actions).toEqual([]);
    expect(transitionIncident(error.state, failed("PAYMENT_IFRAME_MISSING")).actions).toEqual([
      { type: "openIncident" },
    ]);
  });

  it("reopens a recent incident during cooldown without an opened-alert action", () => {
    const state = {
      ...base,
      consecutiveFails: 1,
      recentlyResolved: { id: "i1", resolvedAt: new Date("2026-07-20T11:50:00Z") },
    };
    const result = transitionIncident(state, failed("CHECKOUT_HTTP_5XX"), {
      now: new Date("2026-07-20T12:00:00Z"),
    });
    expect(result.actions).toEqual([{ type: "reopenIncident", incidentId: "i1" }]);
  });

  it("routes PRODUCT_UNAVAILABLE to attention and autopause, never an incident", () => {
    const second = transitionIncident(
      { ...base, consecutiveFails: 1, consecutiveProductUnavailable: 1 },
      failed("PRODUCT_UNAVAILABLE"),
    );
    expect(second.actions).toEqual([{ type: "flagMonitorAttention", autoPause: false }]);
    const sixth = transitionIncident(
      { ...base, consecutiveFails: 5, consecutiveProductUnavailable: 5 },
      failed("PRODUCT_UNAVAILABLE"),
    );
    expect(sixth.actions).toEqual([{ type: "flagMonitorAttention", autoPause: true }]);
    expect(sixth.state.enabled).toBe(false);
  });
});

function failed(failureCode: string): IncidentRunResult {
  return { status: "failed", failureCode };
}
