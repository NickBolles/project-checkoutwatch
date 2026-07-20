import { expect, it } from "vitest";
import { DIAGNOSIS_PACKAGE } from "../src/index.js";

it("exposes the diagnosis package boundary", () => {
  expect(DIAGNOSIS_PACKAGE).toBe("@checkoutwatch/diagnosis");
});
