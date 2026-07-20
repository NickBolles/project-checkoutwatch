export type RunStatus = "passed" | "failed" | "error";
export type StepName = "visit_product" | "add_to_cart" | "go_to_checkout" | "assert_payment_step";
export type FailureCode =
  | "PRODUCT_HTTP_ERROR"
  | "ADD_TO_CART_NOT_FOUND"
  | "ADD_TO_CART_FAILED"
  | "CART_EMPTY"
  | "CHECKOUT_HTTP_5XX"
  | "CHECKOUT_NOT_REACHED"
  | "PAYMENT_IFRAME_MISSING"
  | "CONTACT_INPUT_MISSING"
  | "PRODUCT_UNAVAILABLE"
  | "BOT_CHALLENGE"
  | "STORE_UNREACHABLE"
  | "CONTROL_PROBE_FAILED"
  | "BROWSER_ERROR"
  | `TIMEOUT_STEP_${Uppercase<StepName>}`;

export interface CheckoutTestDefinition {
  storeUrl: string;
  productHandle: string;
  variantId?: string;
  timeoutMs: number;
}

export interface StepResult {
  name: StepName;
  durationMs: number;
  httpStatus?: number;
}

export interface ConsoleArtifact { type: "warning" | "error"; text: string }
export interface FailedRequestArtifact { url: string; method: string; status?: number; error?: string }

export interface CheckRunResult {
  runId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: StepResult[];
  scriptOrigins: string[];
  console: ConsoleArtifact[];
  failedRequests: FailedRequestArtifact[];
  failureStep?: StepName;
  failureCode?: FailureCode;
  failureMessage?: string;
  screenshotPath?: string;
  robotsTxt?: { status?: number; body?: string; error?: string };
}
