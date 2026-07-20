import { expect, it } from "vitest";
import { QUEUE_PACKAGE } from "../src/index.js";

it("exposes the queue package boundary", () => {
  expect(QUEUE_PACKAGE).toBe("@checkoutwatch/queue");
});
