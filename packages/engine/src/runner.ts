import { randomUUID } from "node:crypto";
import { chromium, errors, type Browser, type BrowserContext, type Page } from "playwright";
import { LocalArtifactStore, type ArtifactStore } from "./artifact-store.js";
import { attachCapture, type CaptureBuffer } from "./capture.js";
import { CHECKOUTWATCH_USER_AGENT, controlProbe, fetchRobotsTxt } from "./compliance.js";
import type {
  CheckRunResult,
  CheckoutTestDefinition,
  FailureCode,
  StepName,
  StepResult,
} from "./definition.js";
import { CheckoutAssertionError } from "./errors.js";
import { addToCart } from "./steps/add-to-cart.js";
import { assertPaymentStep } from "./steps/assert-payment.js";
import { goToCheckout } from "./steps/go-to-checkout.js";
import { visitProduct } from "./steps/visit-product.js";

export interface CheckoutRunnerOptions {
  browser?: Browser;
  artifactStore?: ArtifactStore;
  controlProbeUrl?: string;
  knownPaymentOrigins?: readonly string[];
  fetchImpl?: typeof fetch;
  hardTimeoutMs?: number;
}

export class CheckoutRunner {
  private readonly artifactStore: ArtifactStore;
  constructor(private readonly options: CheckoutRunnerOptions = {}) {
    this.artifactStore = options.artifactStore ?? new LocalArtifactStore();
  }

  async run(definition: CheckoutTestDefinition): Promise<CheckRunResult> {
    const runId = randomUUID();
    const start = Date.now();
    const startedAt = new Date(start).toISOString();
    const robotsPromise = fetchRobotsTxt(definition.storeUrl, this.options.fetchImpl);
    let browser = this.options.browser;
    let ownsBrowser = false;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let capture: CaptureBuffer = { console: [], failedRequests: [], scriptOrigins: new Set() };
    const steps: StepResult[] = [];
    let currentStep: StepName = "visit_product";
    let watchdogExpired = false;
    const hardTimeoutMs = this.options.hardTimeoutMs ?? Math.max(60_000, definition.timeoutMs * 6);
    const watchdog = setTimeout(() => {
      watchdogExpired = true;
      void context?.close().catch(() => undefined);
      if (ownsBrowser) void browser?.close().catch(() => undefined);
    }, hardTimeoutMs);
    try {
      if (!browser) {
        browser = await chromium.launch({ headless: true, timeout: hardTimeoutMs });
        ownsBrowser = true;
      }
      context = await browser.newContext({
        userAgent: CHECKOUTWATCH_USER_AGENT,
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });
      capture = attachCapture(context, new URL(definition.storeUrl).origin);
      page = await context.newPage();
      currentStep = "visit_product";
      await timed(steps, currentStep, () => visitProduct(page!, definition));
      currentStep = "add_to_cart";
      await timed(steps, currentStep, () => addToCart(page!, definition));
      currentStep = "go_to_checkout";
      await timed(steps, currentStep, () => goToCheckout(page!, definition));
      currentStep = "assert_payment_step";
      await timed(steps, currentStep, async () => {
        await assertPaymentStep(page!, this.options.knownPaymentOrigins ?? []);
        return undefined;
      });
      return finish({
        runId,
        status: "passed",
        startedAt,
        start,
        steps,
        capture,
        robotsTxt: await robotsPromise,
      });
    } catch (error) {
      const classified = watchdogExpired
        ? {
            status: "error" as const,
            step: currentStep,
            code: "ENGINE_WATCHDOG_TIMEOUT" as const,
            message: `Checkout engine exceeded the ${hardTimeoutMs}ms hard deadline`,
          }
        : await this.classify(error, currentStep);
      if (classified.code.startsWith("TIMEOUT_") && capture.failedRequests.length === 0) {
        capture.failedRequests.push({
          url: page?.url() ?? definition.storeUrl,
          method: "GET",
          error: classified.message,
        });
      }
      let screenshotPath: string | undefined;
      if (page && !page.isClosed()) {
        try {
          screenshotPath = await this.artifactStore.write(
            runId,
            "failure.png",
            await page.screenshot({ fullPage: true }),
          );
        } catch {
          // Screenshot is best-effort after a crashed navigation.
        }
      }
      return finish({
        runId,
        status: classified.status,
        startedAt,
        start,
        steps,
        capture,
        failureStep: classified.step,
        failureCode: classified.code,
        failureMessage: classified.message,
        ...(screenshotPath ? { screenshotPath } : {}),
        robotsTxt: await robotsPromise,
      });
    } finally {
      clearTimeout(watchdog);
      await context?.close().catch(() => undefined);
      if (ownsBrowser) await browser?.close().catch(() => undefined);
    }
  }

  private async classify(
    error: unknown,
    step: StepName,
  ): Promise<{ status: "failed" | "error"; step: StepName; code: FailureCode; message: string }> {
    if (error instanceof CheckoutAssertionError) {
      return {
        status: error.code === "BOT_CHALLENGE" ? "error" : "failed",
        step: error.step,
        code: error.code,
        message: error.message,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      step === "visit_product" &&
      (error instanceof errors.TimeoutError ||
        /timeout|ERR_|ECONN|ENOTFOUND|fetch failed|Navigation failed/i.test(message))
    ) {
      const controlOk = this.options.controlProbeUrl
        ? await controlProbe(this.options.controlProbeUrl, this.options.fetchImpl)
        : false;
      return controlOk
        ? { status: "failed", step, code: "STORE_UNREACHABLE", message }
        : {
            status: "error",
            step,
            code: "CONTROL_PROBE_FAILED",
            message: `Store and control probe were unreachable: ${message}`,
          };
    }
    if (error instanceof errors.TimeoutError || /timeout/i.test(message)) {
      return {
        status: "failed",
        step,
        code: `TIMEOUT_STEP_${step.toUpperCase()}` as FailureCode,
        message,
      };
    }
    return { status: "error", step, code: "BROWSER_ERROR", message };
  }
}

async function timed(
  steps: StepResult[],
  name: StepName,
  operation: () => Promise<number | undefined>,
): Promise<void> {
  const start = Date.now();
  try {
    const httpStatus = await operation();
    steps.push({
      name,
      durationMs: Date.now() - start,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  } catch (error) {
    steps.push({ name, durationMs: Date.now() - start });
    throw error;
  }
}

function finish(input: {
  runId: string;
  status: "passed" | "failed" | "error";
  startedAt: string;
  start: number;
  steps: StepResult[];
  capture: CaptureBuffer;
  robotsTxt: Awaited<ReturnType<typeof fetchRobotsTxt>>;
  failureStep?: StepName;
  failureCode?: FailureCode;
  failureMessage?: string;
  screenshotPath?: string;
}): CheckRunResult {
  const finishedAt = new Date();
  return {
    runId: input.runId,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - input.start,
    steps: input.steps,
    scriptOrigins: [...input.capture.scriptOrigins].sort(),
    console: input.capture.console,
    failedRequests: input.capture.failedRequests,
    ...(input.failureStep ? { failureStep: input.failureStep } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
    ...(input.screenshotPath ? { screenshotPath: input.screenshotPath } : {}),
    robotsTxt: input.robotsTxt,
  };
}
