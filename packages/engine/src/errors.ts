import type { FailureCode, StepName } from "./definition.js";

export class CheckoutAssertionError extends Error {
  constructor(readonly code: FailureCode, message: string, readonly step: StepName) {
    super(message);
    this.name = "CheckoutAssertionError";
  }
}
