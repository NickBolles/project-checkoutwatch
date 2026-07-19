# CheckoutWatch — Synthetic Checkout Monitoring for Shopify

> **A robot buys from your store every 10 minutes. The moment checkout breaks, you know — before your customers do.**

**Status:** planning · **Priority:** #3 build · **Target:** $19–49/mo

## Why this exists

Verified research (July 2026):

- First-hand merchant testimony: checkout upsells **silently stopped working** and only a monitoring app caught it (verified Nov 2024 review). A separate first-hand report: a Stripe iframe failed for 8 hours with "100% uptime," costing ~$3k in sales.
- Merchants distrust Shopify's own status page ("shows everything is awesome" during real incidents — verified review complaint).
- Incumbent **Uptime** ($29/$99/$299) sells real UI tests only at $99/mo; its $29 tier is status-only. Our wedge: **real browser checkout tests at $19–29/mo + AI failure diagnosis**.
- Distribution warning (verified): a competing app has zero reviews 17 months after launch — a listing alone does not convert here. Active distribution (content, r/shopify, agency partnerships, a public "Shopify status — actually tested" page) is part of the product plan, not an afterthought.

## Key docs

- [`PLAN.md`](./PLAN.md) — full MVP spec: features, architecture, pricing, distribution, risks.

## Kickoff Prompt

Paste this into Claude Code from the repo root to start:

```
Read PLAN.md carefully. You are helping me build CheckoutWatch, a Shopify embedded app
plus a Playwright worker fleet, as a solo developer targeting a 5-6 week MVP.

Phase 0 — feasibility spikes (before any product code):
1. Write a standalone Playwright script that runs a full checkout walk-through against a
   Shopify dev store: visit -> add to cart -> checkout -> assert the payment step renders.
   Stop before payment. Document every selector/assertion choice and how we make it
   resilient to theme differences (assertion-level, not pixel-level).
2. Research: Shopify's rules on automated storefront traffic + bot-detection behavior on
   checkout, and how to run this respectfully (identified user agent, allowlisting docs,
   frequency caps). Summarize in docs/COMPLIANCE.md. If there's a blocker, tell me first.
3. Verify current Uptime app pricing/features so our wedge claim is still true at build time.

Phase 1 — plan:
4. docs/ARCHITECTURE.md: worker pool design (queue, VPS sizing for ~$40-50/mo, 10-15 min
   intervals), failure pipeline (screenshot + console errors + failed requests -> AI
   plain-English diagnosis), 2-consecutive-failure debounce, and the embedded app dashboard.
5. Week-by-week GitHub issue breakdown with acceptance criteria, including the public
   "Shopify status — actually tested" page as a launch asset.

Phase 2 — scaffold and build the worker first; show me a real caught failure (break my
dev store's checkout deliberately) before building the dashboard.

Constraints: false positives are the #1 churn driver — always re-check before alerting.
Reuse the AlertProof alert-delivery layer for notifications rather than rebuilding it.
```

## Portfolio context

Third build (`alertproof` → `skuforge` → `checkoutwatch` → `ticketpilot`). Reuses AlertProof's alert-delivery layer and cross-sells to its merchant base: "you trust us for alerts; now let us test your checkout."
