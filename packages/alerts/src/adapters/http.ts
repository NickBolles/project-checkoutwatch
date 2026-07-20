import type { DeliveryResult } from "../types.js";

export type Fetch = typeof fetch;

export async function postJson(
  fetchImpl: Fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ result: DeliveryResult; payload: unknown }> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = undefined;
    try {
      payload = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      return { result: { status: "failed", error: `HTTP ${response.status}: ${text}` }, payload };
    }
    return { result: { status: "delivered" }, payload };
  } catch (error) {
    return {
      result: { status: "failed", error: error instanceof Error ? error.message : String(error) },
      payload: undefined,
    };
  }
}
