import { expect, it } from "vitest";
import { ENGINE_PACKAGE } from "../src/index.js";

it("exposes the engine package boundary", () => {
  expect(ENGINE_PACKAGE).toBe("@checkoutwatch/engine");
});
