import { describe, expect, it } from "vitest";
import { readStepTimings, writeJson } from "../src/json.js";

describe("portable JSON columns", () => {
  it("round-trips and validates step timings", () => {
    const stepTimingsJson = writeJson([{ step: "visit_product", ms: 125, httpStatus: 200 }]);

    expect(readStepTimings({ stepTimingsJson })).toEqual([
      { step: "visit_product", ms: 125, httpStatus: 200 },
    ]);
  });

  it("rejects malformed stored values", () => {
    expect(() => readStepTimings({ stepTimingsJson: "not-json" })).toThrow(
      "Stored JSON column contains invalid JSON",
    );
    expect(() => readStepTimings({ stepTimingsJson: '[{"step":"x","ms":-1}]' })).toThrow();
  });
});
