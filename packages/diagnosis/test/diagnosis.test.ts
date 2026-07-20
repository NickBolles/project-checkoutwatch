import { describe, expect, it, vi } from "vitest";
import {
  AnthropicDiagnoser,
  DEFAULT_LLM_MODEL,
  HeuristicDiagnoser,
  createDiagnoser,
  type FailureContext,
} from "../src/index.js";

const failureCodes = [
  "PRODUCT_HTTP_ERROR",
  "ADD_TO_CART_NOT_FOUND",
  "ADD_TO_CART_FAILED",
  "CART_EMPTY",
  "CHECKOUT_HTTP_5XX",
  "CHECKOUT_NOT_REACHED",
  "PAYMENT_IFRAME_MISSING",
  "CONTACT_INPUT_MISSING",
  "PRODUCT_UNAVAILABLE",
  "BOT_CHALLENGE",
  "STORE_UNREACHABLE",
  "CONTROL_PROBE_FAILED",
  "BROWSER_ERROR",
  "TIMEOUT_STEP_GO_TO_CHECKOUT",
] as const;

describe("HeuristicDiagnoser", () => {
  it.each(failureCodes)("maps %s to stable plain-English output", async (failureCode) => {
    const diagnoser = new HeuristicDiagnoser();
    const first = await diagnoser.diagnose(context({ failureCode }));
    const second = await diagnoser.diagnose(context({ failureCode }));
    expect(first).toEqual(second);
    expect(first.summary.length).toBeGreaterThan(15);
    expect(first.probableCause.length).toBeGreaterThan(15);
    expect(["low", "medium", "high"]).toContain(first.confidence);
    expect(first.provider).toBe("heuristic");
  });

  it("cites a recently added script and payment request failure", async () => {
    const result = await new HeuristicDiagnoser().diagnose(
      context({
        failureCode: "PAYMENT_IFRAME_MISSING",
        failedRequests: [{ method: "GET", url: "https://pay.example.test/card.js", status: 503 }],
        recentChanges: [
          {
            kind: "script_added",
            detectedAt: "2026-07-20T00:00:00.000Z",
            detail: { origin: "https://apps.example.test" },
          },
        ],
      }),
    );
    expect(result.probableCause).toContain("payment provider's iframe failed");
    expect(result.probableCause).toContain("https://apps.example.test");
  });
});

describe("AnthropicDiagnoser", () => {
  it("sends the current model and JSON-schema output request, then validates the response", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: "Checkout failed",
              probableCause: "Payment app did not load",
              evidence: ["iframe absent"],
              confidence: "high",
            }),
          },
        ],
      });
    const result = await new AnthropicDiagnoser({ messages: { create } }).diagnose(context());
    expect(result).toMatchObject({
      provider: "anthropic",
      model: DEFAULT_LLM_MODEL,
      confidence: "high",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-8",
        output_config: { format: expect.objectContaining({ type: "json_schema" }) },
        messages: [{ role: "user", content: expect.stringContaining("PAYMENT_IFRAME_MISSING") }],
      }),
      { timeout: 10_000 },
    );
  });

  it.each(["invalid output", "api error"])("falls back deterministically on %s", async (mode) => {
    const create =
      mode === "invalid output"
        ? vi.fn().mockResolvedValue({ content: [{ type: "text", text: "not-json" }] })
        : vi.fn().mockRejectedValue(new Error("offline"));
    const onFallback = vi.fn();
    const result = await new AnthropicDiagnoser({ messages: { create } }, { onFallback }).diagnose(
      context(),
    );
    expect(result.provider).toBe("heuristic");
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("factory uses the deterministic port when the API key is unset", async () => {
    const diagnoser = createDiagnoser({ allowLlm: true, provider: "anthropic" });
    expect((await diagnoser.diagnose(context())).provider).toBe("heuristic");
  });
});

function context(overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    runId: "run-1",
    monitorId: "monitor-1",
    storeUrl: "https://shop.example.test",
    productHandle: "product",
    failureCode: "PAYMENT_IFRAME_MISSING",
    failureStep: "assert_payment_step",
    consoleErrors: [],
    failedRequests: [],
    scriptOriginDiff: { added: [], removed: [] },
    recentChanges: [],
    stepTimings: [],
    recentRuns: [],
    ...overrides,
  };
}
