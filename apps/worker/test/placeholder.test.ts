import { expect, it } from "vitest";
import { WORKER_APP } from "../src/index.js";

it("exposes the worker app boundary", () => {
  expect(WORKER_APP).toBe("@checkoutwatch/worker");
});
