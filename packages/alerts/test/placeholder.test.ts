import { expect, it } from "vitest";
import { ALERTS_PACKAGE } from "../src/index.js";

it("exposes the alerts package boundary", () => {
  expect(ALERTS_PACKAGE).toBe("@checkoutwatch/alerts");
});
