import type { BrowserContext, Page, Request, Response } from "playwright";
import type { ConsoleArtifact, FailedRequestArtifact } from "./definition.js";

export interface CaptureBuffer {
  console: ConsoleArtifact[];
  failedRequests: FailedRequestArtifact[];
  scriptOrigins: Set<string>;
}

export function attachCapture(context: BrowserContext, storeOrigin: string): CaptureBuffer {
  const buffer: CaptureBuffer = { console: [], failedRequests: [], scriptOrigins: new Set() };
  context.on("page", (page) => attachPage(page, buffer, storeOrigin));
  for (const page of context.pages()) attachPage(page, buffer, storeOrigin);
  return buffer;
}

function attachPage(page: Page, buffer: CaptureBuffer, storeOrigin: string): void {
  page.on("console", (message) => {
    const type = message.type();
    if (type === "warning" || type === "error") {
      buffer.console.push({ type, text: message.text() });
    }
  });
  page.on("requestfailed", (request) => addFailedRequest(buffer, request));
  page.on("response", (response) => addResponse(buffer, response, storeOrigin));
}

function addFailedRequest(buffer: CaptureBuffer, request: Request): void {
  const error = request.failure()?.errorText;
  buffer.failedRequests.push({
    url: request.url(), method: request.method(),
    ...(error ? { error } : {}),
  });
}

function addResponse(buffer: CaptureBuffer, response: Response, storeOrigin: string): void {
  const request = response.request();
  if (response.status() >= 400) buffer.failedRequests.push({ url: response.url(), method: request.method(), status: response.status() });
  if (request.resourceType() === "script") {
    try {
      const loadedOrigin = new URL(response.url()).origin;
      if (loadedOrigin !== storeOrigin) buffer.scriptOrigins.add(loadedOrigin);
    } catch {
      // Ignore non-URL browser resources.
    }
  }
}
