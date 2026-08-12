# Shopify App Store listing — draft copy

**Status:** draft, ready for your review. Everything here is written to Shopify's listing field limits and can be pasted directly into the Partner Dashboard.

**Two decisions gate publishing this:**

1. **Brand.** Copy below says _CheckoutWatch_. If you go with _Checkout Harbor_ (the `docs/PROGRESS.md` recommendation), the swap is mechanical — see §9.
2. **No competitor claims.** `README.md` flags that the competitor pricing wedge needs re-verification before it's stated publicly, so none of this copy names or compares against another app. It sells the capability directly.

---

## 1. App name

> CheckoutWatch

_(30 char limit — 13 used.)_

## 2. App card subtitle

Shown under the name in search results. **62 char limit.**

> Catch broken checkout before your customers do

_(46 used.)_

## 3. App introduction

The one-liner at the top of the listing page. **100 char limit.**

> A real browser buys from your store every few minutes and alerts you the moment checkout breaks.

_(96 used.)_

## 4. App details

The main description. **500 char limit.** Shopify strips formatting, so this is plain prose.

> Uptime monitors tell you your store responded. They don't tell you a customer could actually buy something. CheckoutWatch runs a real browser through your storefront on a schedule — product page, add to cart, checkout, payment step — and confirms each step actually worked.
>
> When it breaks, you get an alert within minutes with a screenshot of the failure, the console errors behind it, and what changed on your store just before it started.
>
> It never completes an order.

_(494 used.)_

## 5. Feature list

Up to five, each a short title plus one sentence.

| #   | Title                                  | Description                                                                                                                  |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Real checkout tests, not ping checks   | A real browser walks your product page, cart, and checkout and asserts the payment step actually rendered.                   |
| 2   | Alerts you can trust                   | Every failure is re-tested before you're paged, so a one-off blip never wakes you at 3am.                                    |
| 3   | Failure evidence, not just a red light | Each incident includes a screenshot, console errors, failed network requests, and a plain-English diagnosis.                 |
| 4   | See what changed right before          | CheckoutWatch tracks theme updates and third-party scripts, so you can see what shipped just before checkout broke.          |
| 5   | A status page that means something     | Publish real, tested checkout availability to your team or customers — backed by actual purchases attempts, not a heartbeat. |

## 6. Screenshots

Minimum 3, **1600×900**. Shoot these from the dev store after the first real monitor is running — they must show real data, not the empty state.

| #   | Screen                        | What must be visible                                               | Caption                                                      |
| --- | ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | Dashboard with a live monitor | Green status, uptime %, a response-time sparkline with real points | Know your checkout works — verified minutes ago, not assumed |
| 2   | Incident detail page          | The failure screenshot, failing step, and the diagnosis card       | Every failure comes with the evidence to fix it              |
| 3   | Incident "what changed" panel | Theme/script change events timestamped before the incident         | See what shipped right before checkout broke                 |
| 4   | Setup wizard                  | Product picker with real products, interval selector               | Set up in under a minute — pick a product, pick a frequency  |
| 5   | Public status page            | 90-day uptime bars and incident history                            | Publish availability your team can actually trust            |

> **Do not screenshot the empty state or seeded fixture data.** Reviewers check that screenshots match the real app.

## 7. Support and legal URLs

Both of these are now **live routes served by the app itself** — no separate domain needed:

| Field                | Value                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privacy policy URL   | `https://checkoutwatch.srv1073822.hstgr.cloud/legal/privacy`                                                                                                                                                 |
| Bot information page | `https://checkoutwatch.srv1073822.hstgr.cloud/bot`                                                                                                                                                           |
| Support email        | **Needs a real, monitored inbox.** Copy currently references `support@checkoutwatch.app` / `privacy@checkoutwatch.app` — either register that domain's mail or change these to an address you actually read. |
| FAQ / docs URL       | Optional; can be omitted for v1                                                                                                                                                                              |

⚠️ The privacy policy is a **draft grounded in what the code actually does**, not legal advice. Have it reviewed before publishing.

## 8. Pricing

Matches [`packages/core/src/plans.ts`](../packages/core/src/plans.ts) exactly — the listing and the code must not drift.

| Plan   | Price      | Trial   | What the listing should say                                                         |
| ------ | ---------- | ------- | ----------------------------------------------------------------------------------- |
| Free   | $0         | —       | 1 monitor, hourly checks, email alerts                                              |
| Growth | **$19/mo** | 14 days | 3 monitors, checks every 10 minutes, Slack and Discord alerts, AI failure diagnosis |
| Pro    | **$49/mo** | 14 days | 10 monitors, checks every 5 minutes, SMS alerts, public status page                 |

Configure these as Shopify-managed pricing in the Partner Dashboard.

> **SMS on Pro is gated on Twilio A2P registration.** If that isn't complete at submission, drop the SMS bullet from the Pro plan rather than listing a feature that can't deliver.

## 9. Categories and search terms

- **Primary category:** Store management → Site monitoring (or nearest available)
- **Search terms:** checkout monitoring, uptime monitoring, synthetic monitoring, checkout testing, downtime alerts, store health, checkout errors, conversion protection

## 10. Reviewer instructions

Shopify's reviewer needs a path to see the app work. Paste something like:

> 1. Install on a development store that has at least one in-stock product.
> 2. The app opens on a setup wizard. Pick any product and choose the default interval.
> 3. A first test runs immediately; the dashboard shows the result within about a minute.
> 4. To see failure handling, set the chosen product's inventory to zero and use "Run now" — the run is recorded as needing attention rather than as an outage, which is the intended behavior for a sold-out product.
> 5. Billing: the upgrade flow uses Shopify's Billing API and appears as a test charge on a development store.
>
> Note on automated traffic: CheckoutWatch performs merchant-authorized synthetic checkout tests. It identifies itself with a `CheckoutWatchBot/1.0` user agent, never enters data into any checkout field, never completes an order, and never bypasses a CAPTCHA or bot challenge. Details: <https://checkoutwatch.srv1073822.hstgr.cloud/bot>

## 11. If the brand changes to Checkout Harbor

Mechanical find-and-replace across:

- This file, and §1–§5 copy above
- `apps/web/app/routes/bot.tsx` and `legal.privacy.tsx` (brand line, support email)
- `packages/engine/src/compliance.ts` — the `CheckoutWatchBot/1.0` UA token itself
- `shopify.app.toml` — `name` and `handle`
- `apps/web/app/routes/status.$slug.tsx` — the `CHECKOUTWATCH` brand line
- App icon and screenshots

Do this **before** submission, not after — the app name is hard to change once listed.

---

## Still missing before you can submit

| Item                               | Who    | Note                                                                |
| ---------------------------------- | ------ | ------------------------------------------------------------------- |
| App icon, 1200×1200                | Design | The only asset that can't be generated from the running app         |
| 3–5 screenshots, 1600×900          | You    | Must be taken after the first real monitor is live (Day 2, task C1) |
| A monitored support inbox          | You    | Currently pointing at an unregistered domain                        |
| Legal review of the privacy policy | You    | Draft is live at `/legal/privacy`                                   |
| Automated-traffic policy clearance | You    | `docs/COMPLIANCE.md` requires this before public launch             |
