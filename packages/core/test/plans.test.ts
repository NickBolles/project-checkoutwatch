import { describe, expect, it } from "vitest";
import { canUseChannel, clampInterval, maxMonitors, PLANS } from "../src/plans.js";

describe("plan entitlements", () => {
  it("clamps intervals to the plan floor", () => {
    expect(clampInterval("free", 5)).toBe(60);
    expect(clampInterval("growth", 15)).toBe(15);
    expect(clampInterval("pro", Number.NaN)).toBe(5);
  });

  it("gates channels and monitor counts", () => {
    expect(canUseChannel("free", "email")).toBe(true);
    expect(canUseChannel("growth", "sms")).toBe(false);
    expect(canUseChannel("pro", "sms")).toBe(true);
    expect(maxMonitors("free")).toBe(1);
    expect(maxMonitors("growth")).toBe(3);
    expect(maxMonitors("pro")).toBe(10);
  });

  it("publishes the finalized Free, $19, and $49 billing metadata", () => {
    expect([
      PLANS.free.priceMonthlyUsd,
      PLANS.growth.priceMonthlyUsd,
      PLANS.pro.priceMonthlyUsd,
    ]).toEqual([0, 19, 49]);
    expect(PLANS.growth.trialDays).toBe(14);
    expect(PLANS.pro.entitlements.channels).toContain("sms");
    expect(PLANS.free.entitlements.publicStatusPage).toBe(false);
    expect(PLANS.pro.entitlements.publicStatusPage).toBe(true);
  });
});
