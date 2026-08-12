import type { Page } from "playwright";

export const DEFAULT_BOT_INFO_URL = "https://checkoutwatch.app/bot";

/**
 * The identifying user agent every synthetic request carries. The `+url` must
 * resolve to a page explaining who the bot is and how to allowlist or exclude it
 * -- a dead link there is worse than no link, since merchants and their security
 * vendors use it to decide whether the traffic is legitimate. Deployments pass
 * their own app URL so the link stays correct across domains and rebrands.
 */
export function checkoutWatchUserAgent(botInfoUrl: string = DEFAULT_BOT_INFO_URL): string {
  return `CheckoutWatchBot/1.0 (+${botInfoUrl})`;
}

export const CHECKOUTWATCH_USER_AGENT = checkoutWatchUserAgent();

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
  const challenge = page.locator(
    "#captcha, [data-captcha], iframe[src*='captcha'], input[name='cf-turnstile-response']",
  );
  return /just a moment|verify you are human|captcha/i.test(title) || (await challenge.count()) > 0;
}

export function enforceFrequencyFloor(
  lastRunAt: Date | undefined,
  now: Date,
  floorMs: number,
): boolean {
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= floorMs;
}
