# CheckoutWatch — MVP Plan

## Spec 1: Checkout-Flow Monitoring for Shopify ("CheckoutWatch")
**Rank #3 · Target $19–29/mo · Build: 5–6 weeks · Verified niche: real pain, thin competition, weak organic conversion**

### Pitch
"A robot buys from your store every 10 minutes. The moment checkout breaks, you know — before your customers do." Verified wedge: incumbent Uptime sells real UI tests only at $99/mo (its $29 tier is status-monitoring only); we sell real browser tests at $19–29.

### Target customer
Stores doing $10k+/mo (where an hour of broken checkout is real money), stores running paid ads (broken checkout burns ad spend), and stores with heavy app stacks (apps break checkouts silently — the verified Bonafide Health case was a checkout *upsell* app failing).

### MVP features
1. **Scripted browser checkout tests** (Playwright, headless Chromium): visit store → add configured product to cart → proceed through checkout → assert payment step renders (stop before payment; use Shopify's test-order-safe assertions). Default every 15 min; 5 min on Pro.
2. **No-code test setup:** merchant picks a product from a dropdown (via API), we auto-generate the test. Zero scripting — this is the difference from TestingBot's tester-tool DNA and your UI-polish advantage.
3. **Failure intelligence:** on failure — screenshot, console errors, failed network requests, and an AI-written plain-English diagnosis ("The Stripe payment iframe did not load; this began after 2:10 PM; possibly related to app X's script erroring"). The AI diagnosis is the wow feature and demos brilliantly.
4. **Alerts:** email/Slack/Discord/SMS, with a re-check-before-alerting debounce (2 consecutive failures) to kill false positives — false alarms are the #1 churn driver in monitoring products.
5. **Status dashboard:** uptime %, response-time trend, incident history. Public status page = Pro upsell.
6. **App-stack change log:** record when the store's installed apps/theme change, and annotate incidents with "what changed right before" — cheap to build, directly addresses the verified "an app broke our checkout" failure mode.

**OUT of MVP:** multi-store agencies, non-Shopify platforms, synthetic tests beyond checkout (search, filters), performance/Lighthouse audits.

### Architecture
Playwright workers on a cheap VPS pool (~$40–50/mo verified infra estimate; queue via BullMQ/Redis), results to Postgres, Shopify embedded app (Remix + Polaris) for config/dashboard, Billing API. Reuse the entire alert-delivery layer from the staff-alerts app — **build this second and you inherit ~30% of the code.**

### Pricing
Free: 1 test, 60-min interval, email only (exists for reviews/installs). **$19/mo:** 3 tests, 10-min interval, all channels, AI diagnosis. **$49/mo:** 10 tests, 5-min, public status page, SMS.

### Distribution (the hard part — verified: listings alone don't convert here)
Beta via the same r/shopify presence; content targeting "shopify checkout not working" (huge exact-intent search when it happens); a free public "Shopify status — actually tested" page (live results from test stores across regions — the verified complaint that Shopify's own status page shows all-clear during incidents makes this a traffic magnet and permanent lead-gen); agency partnerships (agencies managing 10+ stores are one sale = 10 subscriptions; offer 30% recurring referral).

### Risks
Shopify checkout DOM changes break tests (mitigate: assertion-level checks not pixel checks, canary suite on your own dev stores); bot-detection on checkouts (mitigate: respect robots, identify your agent, document allowlisting); niche is verified-small — treat $500–800/mo as success, not a stepping stone to $10k.

---

