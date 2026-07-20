import { describe, expect, it } from "vitest";
import { diffScriptOrigins } from "../src/index.js";

describe("diffScriptOrigins", () => {
  it.each([
    {
      before: ["https://a.test"],
      after: ["https://a.test", "https://b.test"],
      added: ["https://b.test"],
      removed: [],
    },
    {
      before: ["https://a.test", "https://b.test"],
      after: ["https://a.test"],
      added: [],
      removed: ["https://b.test"],
    },
    { before: ["https://a.test"], after: ["https://a.test"], added: [], removed: [] },
  ])("computes added/removed/unchanged", ({ before, after, added, removed }) => {
    expect(diffScriptOrigins(before, after)).toEqual({ added, removed });
  });
});
