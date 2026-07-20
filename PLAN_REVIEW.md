# CheckoutWatch IMPLEMENTATION_PLAN.md — Adversarial Review

**Verdict: SOLID SKELETON, NOT IMPLEMENTATION-READY AS WRITTEN — 3 blockers (alerts-package portability drift vs AlertProof, an inverted error-vs-outage taxonomy that would make the monitor blind to full store outages, and missing scheduler/run concurrency guarantees), 7 majors. All blockers and majors have been folded into IMPLEMENTATION_PLAN.md; with those revisions the plan is implementation-ready.**

Reviewed against: `PLAN.md` (scope source of truth), `README.md`, `alertproof/IMPLEMENTATION_PLAN.md` (portability target). Model-id claims verified against current Anthropic reference (2026-07): `claude-opus-4-8` is a valid current model id, and `output_config.format` JSON-schema output is the correct structured-output surface — the plan's diagnosis section is correct on both counts.

---

## BLOCKERS

### B1. `packages/alerts` is NOT shape-compatible with AlertProof — the "portable unchanged / ~30% reuse" claim is false as specced

The two plans drift on every load-bearing interface:

| Concern | AlertProof plan | CheckoutWatch plan (pre-revision) |
|---|---|---|
| Adapter surface | Per-provider ports **with status-webhook methods on them**: `EmailProvider.{send, verifyStatusWebhook, parseStatusEvent}`, `SmsProvider.{send, parseStatusCallback}`, `ChatWebhookProvider.postToWebhookUrl` | Uniform `AlertChannelAdapter.{type, send}` only; webhook parsing lives in a separate `status-webhooks.ts` module |
| Delivery statuses | `PENDING\|SENDING\|SENT\|DELIVERED\|BOUNCED\|DEFERRED\|FAILED\|SKIPPED` | `queued\|sent\|delivered\|bounced\|failed` — missing `sending` (the crash-safe conditional-transition state), `deferred`, `skipped` (AlertProof's plan-gating + honest-log mechanism) |
| Dispatch model | DB-claim based: conditional UPDATE `PENDING→SENDING` (affected rows = 1), SKIP LOCKED batches — crash-safe, concurrency-safe | In-memory fan-out class; `DeliveryLogStore` port has only `record`/`updateStatus` — no claim/transition primitive, so AlertProof's dispatcher semantics cannot be implemented behind the port |
| Provider status ingestion | Adapter owns verify + parse (`verifyStatusWebhook`) | Pure mapper functions, no signature verification in the package |
| Mock convention | `MockOutbox` table + `mock://` destination scheme | JSONL files in `var/outbox/`, no `mock://` |
| Email provider | Postmark primary (`EmailProvider` interface allows Resend later) | Resend only |

Any one of these is survivable; together they mean the package could not be dropped into AlertProof (or vice versa) without rewriting its public surface — killing the PLAN.md architecture bet ("build this second and you inherit ~30% of the code").

**Fix (applied):** §1.4 rewritten as an explicit cross-repo portability contract: superset `DeliveryStatus` vocabulary (`queued|sending|sent|delivered|bounced|deferred|failed|skipped`); `AlertChannelAdapter` gains optional `verifyStatusWebhook(headers, rawBody)` + `parseStatusEvent(payload)` so each provider adapter owns its callback handling (AlertProof's per-provider port shape, uniform-typed); `DeliveryLogStore` gains claim/transition primitives (`claimQueued`, conditional `transition(id, from, to)` returning success) so the dispatcher is crash/concurrency-safe and AlertProof's Postgres SKIP-LOCKED implementation satisfies the same port; `mock://` destination scheme adopted; email adapter interface documented as provider-plural (Resend impl now, Postmark impl shape-identical). `packages/alerts/README.md` is declared the canonical parity contract both repos build to, with a required reconciliation note for AlertProof's plan.

### B2. Error-vs-outage taxonomy is inverted and deferred to Phase 9 — as written, the product never alerts on the most basic failure: the store being down

Three compounding problems:

1. Phase 9's acceptance criterion — "Engine-error injection (fixture down) produces `error` runs and **no** incident/alert" — classifies *store unreachable* as an engine error. A merchant whose site is hard down would never be paged. That's the one outage every monitoring product must catch.
2. The Phase 5 incident state machine has no `error` input at all (only fail/pass), yet Phase 9 retroactively demands error runs not open incidents. That's a forward dependency: the machine's core contract is defined four phases after the machine is built.
3. The engine (Phase 2) has no `error` result status and no way to distinguish "our Chromium crashed" from "their DNS doesn't resolve" — which are opposite outcomes (suppress vs. alert).

**Fix (applied):** three-way run taxonomy defined in Phase 2 (`passed | failed | error`) with explicit classification rules: `STORE_UNREACHABLE` (DNS/connect/TLS failure to the merchant origin, confirmed by a **control probe** against a known-good endpoint — control passes ⇒ merchant is down ⇒ real `failed`; control also fails ⇒ our network ⇒ `error`); engine/browser crashes, launch failures, and runner bugs ⇒ `error`; `BOT_CHALLENGE` ⇒ `error`-class surfaced to the merchant as a setup issue (see M3). Phase 5 machine consumes all three statuses from day one: `error` runs neither open incidents nor reset `consecutiveFails` (no-signal), consecutive errors raise an internal ops flag. Phase 9 acceptance criteria corrected (engine-crash injection ⇒ no incident; fixture-listener-down with passing control probe ⇒ real incident). Uptime % excludes `error` runs so our bugs never tank a merchant's uptime stat.

### B3. Scheduler and run-execution concurrency is underspecified — double-scheduling and overlapping runs of the same monitor are possible

- The due-monitor query + `nextRunAt` advance is not atomic. Two scheduler instances (a second worker process, or `INLINE_WORKER=1` web + `pnpm worker` running simultaneously — the plan's own dev setup makes this likely) both read the same due monitor and both enqueue.
- Nothing prevents overlapping runs of the same monitor: a slow run (checkout timeout ≈ 60–90s) plus a short interval, or a `recheck` racing the next scheduled `run-check`, corrupts `consecutiveFails`/`lastStatus` and breaks the debounce contract.
- The queue contract suite doesn't test at-least-once semantics — BullMQ can redeliver; the memory driver is naturally exactly-once, so "contract-tested on memory" would not exercise the behavior that breaks in prod.

**Fix (applied):** §1.3/Phase 3 now specify: per-monitor atomic claim via conditional `updateMany` (`WHERE id = ? AND nextRunAt = <seen value>`, affected-rows=1 required) before enqueue; a per-monitor in-flight guard (`run-check`/`recheck` handler conditionally sets `Monitor.runningAt`, skips/requeues if already set, clears with a stale-lock timeout); BullMQ `jobId = monitorId:nextRunAtEpoch` dedupe as belt-and-suspenders; dev rule that `INLINE_WORKER=1` and a separate worker are mutually exclusive; contract suite gains a duplicate-delivery case and handlers are required idempotent.

---

## MAJORS

### M1. Synchronous LLM diagnosis on the alert path delays the page
Phase 5 `openIncident` calls the `Diagnoser` *then* enqueues `dispatch-alert`. A slow/hanging Anthropic call (or retry loop) delays the alert — the product's core promise is speed-to-page. **Fix (applied):** open incident ⇒ dispatch alerts immediately with the deterministic heuristic diagnosis (always available, <1ms); enqueue LLM diagnosis as a separate job with a hard timeout (10s) that *updates* the incident (dashboard + resolution email get the richer text). Alert latency is never coupled to LLM latency.

### M2. Sold-out / deleted product is an unmodeled false-positive class
Merchant's product sells out or gets deleted ⇒ add-to-cart fails ⇒ after debounce, merchant is paged "checkout broken" at 3am for a healthy checkout. This is precisely the churn PLAN.md warns about. **Fix (applied):** engine detects product-availability failures (product 404, variant `available: false` via product JSON / `/cart/add.js` 422) as distinct `PRODUCT_UNAVAILABLE`; incident machine routes it to a "monitor needs attention" notification (email-only, no SMS page, monitor auto-paused after N consecutive) instead of a checkout incident. Fixture gains a `sold_out` mode.

### M3. Bot-detection handling and the consent/authorization model are hand-waved
Shopify's standard robots.txt **disallows `/checkout`** — so "respect robots" (PLAN.md) taken literally forbids the product's core function; and a bot-challenge page mid-run would currently surface as a confusing failure code and page the merchant. The plan must be explicit and honest here or the compliance story collapses. **Fix (applied):** COMPLIANCE.md scope now mandates: (a) authorization basis is *merchant consent* — tests run only against stores that installed the app and only against the configured storefront URL; app uninstall halts traffic immediately (see M4); robots.txt is fetched and logged but the documented position is consent-based synthetic monitoring, not crawling; (b) bot challenges (challenge/captcha page detection) classify as `BOT_CHALLENGE` — an error-class run, never retried aggressively, **never bypassed or evaded**, surfaced to the merchant with allowlisting instructions; (c) frequency floors and identified UA as already planned. Fixture gains a `bot_challenge` mode.

### M4. Uninstall handling and Shopify mandatory compliance webhooks are missing
No `app/uninstalled` behavior is specified (monitors would keep hammering a store that kicked us out — a real ToS/abuse problem), and the GDPR-mandatory topics (`customers/data_request`, `customers/redact`, `shop/redact`) — required for app-store review, present in AlertProof's plan — are absent. **Fix (applied):** Phase 6 webhooks now include the three compliance topics (minimal but real handlers: we store no customer PII; shop/redact purges shop data) and `app/uninstalled` ⇒ disable all monitors, mark `uninstalledAt`, purge encrypted access token, cancel pending jobs.

### M5. Synthetic traffic side effects (analytics pollution, abandoned checkouts) are unaddressed
A robot adding to cart every 10 minutes deflates the merchant's conversion rate, inflates sessions, and creates checkout objects. If the test ever entered an email, Shopify + abandoned-cart apps would send recovery emails. This will generate support tickets and churn. **Fix (applied):** engine invariant extended — never enter contact/customer data into any checkout field (assert payment step presence without form fill); COMPLIANCE.md + merchant docs must cover analytics exclusion (identified UA, published egress IPs, GA/Shopify-analytics bot-filter guidance) and the no-abandoned-checkout-email guarantee; engine tests assert no form input is ever submitted on the checkout page.

### M6. Data-model gaps: no schema enforcement of one open incident per monitor; missing indexes
- "Unique open-incident-per-monitor check inside a transaction" is app-level only; SQLite/Prisma can't express the partial unique index, and the Postgres flip wouldn't add it either as written. Duplicate open incidents ⇒ duplicate pages.
- `AlertDelivery.providerMessageId` is unindexed but is the join key for every Resend/Twilio status webhook (full scan per callback).
- Prisma does not auto-index FK scalar fields: `Monitor.shopId`, `AlertDelivery.incidentId` unindexed.
- `Monitor` has no error-streak field for the B2 ops flag.

**Fix (applied):** `Monitor.openIncidentId String? @unique` (atomically set on open inside the transaction — portable single-open enforcement on both SQLite and Postgres), `@@index([providerMessageId])` on AlertDelivery, `@@index([shopId])` on Monitor, `@@index([incidentId])` on AlertDelivery, `Monitor.consecutiveErrors Int @default(0)`, and a Postgres-flip note to also add the native partial unique index.

### M7. No flap suppression — a flapping checkout produces an alert storm
Machine as specced: fail,fail ⇒ open+page; pass ⇒ resolve+notify; fail,fail ⇒ open+page again... An intermittent payment iframe could page a merchant a dozen times overnight. **Fix (applied):** re-open cooldown — an incident resolved less than `REOPEN_COOLDOWN_MINUTES` (default 30) ago is *reopened* (same incident row, `resolvedAt` cleared, flap counter incremented) and does **not** re-send the `incident_opened` alert (idempotency key unchanged makes this natural); dashboard shows the flap count. Table-driven tests extended with the flapping sequence.

---

## MINORS (not folded into the plan; judgment calls / small items)

1. **Pricing contradiction inherited from PLAN.md:** PLAN.md's feature list says $19 tier gets "all channels" but its pricing table puts SMS at $49. The plan's entitlement table (growth = email+slack+discord, pro = +SMS) is a reasonable resolution — record the deviation explicitly in `packages/core/plans.ts` comments and marketing copy so nobody "fixes" it the wrong way later.
2. **Webhook signature verification is a Phase 9 sweep.** Wiring HMAC verification when each webhook route is *created* (Phase 6) would be better hygiene than a security pass at the end; acceptable locally since no real creds exist before launch, but flag it in Phase 6 code review.
3. **Recheck runs from the same host/network as the failing run**, so a local network blip on the worker confirms itself. The B2 control probe covers the connectivity case; a second-region recheck worker is correctly post-MVP — note it in ARCHITECTURE.md.
4. **The public "Shopify status — actually tested" marketing page** (multi-region test stores — a PLAN.md distribution asset) is only "seeded" by Phase 8's per-merchant status page. Fine, but call it out as an explicit post-MVP launch asset so it isn't silently dropped.
5. **Status-page 60s in-memory cache** is per-process — harmless single-instance, wrong behind >1 web replica. Note for DEPLOYMENT.md.
6. **Incident `failureCode` provenance:** first failure and confirming recheck may fail with different codes (e.g. ADD_TO_CART then TIMEOUT). Store the confirming run's code as `failureCode` and keep both runs linked (openingRunId already exists; the recheck run is queryable) — one-line implementation note.
7. **`console_error` / `third_party_script_added` fixture modes are observation modes, not failures** — a console error alone must not fail a run (assertion-level promise). Now stated in §1.5, but keep an explicit engine test asserting these modes still `pass`.
8. **Model id verified:** `claude-opus-4-8` is current; `output_config.format` is the right structured-output parameter; heuristic-by-default keeps LLM cost at zero until a key exists. Diagnosis only runs on incident-open (low volume), so Opus-tier cost is acceptable; `LLM_MODEL` env already allows downgrading.
9. **BullMQ contract auto-skip without Redis** means CI never exercises the real driver until someone runs it — the plan already flags this (§5.6); make the pre-prod Redis contract run a DEPLOYMENT.md checklist item, not just a note.
10. **`Session.userId BigInt`** — verify against the live template at scaffold time (template drift note already exists, §5.5).

## AlertProof compatibility summary

Pre-revision: **incompatible** (adapter surface, status vocabulary, dispatcher/claim model, status-webhook ownership, mock conventions — see B1 table). Post-revision: §1.4 defines a single portability contract (superset statuses, adapter-owned webhook verify/parse, claimable delivery-log port, `mock://` convention) that AlertProof's Postgres/SKIP-LOCKED implementation and CheckoutWatch's Prisma implementation can both satisfy; `packages/alerts/README.md` is the canonical contract. AlertProof's own plan should adopt the same interface names when built (one-paragraph reconciliation noted in the revised plan).
