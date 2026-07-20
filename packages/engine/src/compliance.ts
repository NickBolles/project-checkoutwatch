import type { Page } from "playwright";

export const CHECKOUTWATCH_USER_AGENT = "CheckoutWatchBot/1.0 (+https://checkoutwatch.app/bot)";

export async function fetchRobotsTxt(storeUrl: string, fetchImpl: typeof fetch = fetch) {
  try {
    const response = await fetchImpl(new URL("/robots.txt", storeUrl));
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function controlProbe(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function isBotChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const challenge = page.locator("#captcha, [data-captcha], iframe[src*='captcha'], input[name='cf-turnstile-response']");
  return /just a moment|verify you are human|captcha/i.test(title) || (await challenge.count()) > 0;
}

export function enforceFrequencyFloor(lastRunAt: Date | undefined, now: Date, floorMs: number): boolean {
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= floorMs;
}
