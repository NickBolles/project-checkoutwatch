# CheckoutWatch — Gap Audit Report

**Date:** 2026-07-20 · **Scope:** implementation vs `PLAN.md` / `IMPLEMENTATION_PLAN.md` / `PLAN_REVIEW.md` / `docs/*` · **Method:** full source read of `packages/*`, `apps/*`, `fixtures/*`, Prisma schema, and test suites. Audit-only; no code modified.

**Overall:** This is a genuinely strong build. Every phase's core logic exists and is real (no `TODO`/`FIXME`/stub markers anywhere in source). The three PLAN_REVIEW blockers (alerts portability contract, three-way run taxonomy, scheduler/run concurrency) are all faithfully implemented and tested, the incident machine matches the spec including flap suppression and `PRODUCT_UNAVAILABLE` routing, the engine never enters checkout form data, the status page sanitizes and Pro-gates correctly, and the offline demo pipeline works. The gaps below are almost all in the seam the local-mock methodology can't see: **what happens when real credentials are dropped in and web + worker become separate processes.** All tests pass precisely because none of them run in that configuration.

---

## (A) Implementation Gaps

### GAP-1 · BLOCKER — BullMQ Redis prefix is per-PID: in production, jobs enqueued by the web app are never consumed by the worker

- **Location:** `packages/queue/src/index.ts:15` (`new BullMQDriver(config.redisUrl, `checkoutwatch-${process.pid}`, ...)`), `packages/queue/src/bullmq-driver.ts:13`
- **What's wrong:** The production driver factory bakes `process.pid` into the Redis key prefix. Web (`apps/web/app/services/runtime.server.ts:37`) and worker (`apps/worker/src/main.ts:26`) are separate processes with different PIDs, so under `QUEUE_DRIVER=bullmq` they operate on disjoint Redis keyspaces. Every web-originated job silently vanishes:
  - the wizard's immediate first run (`web-app.server.ts:130`, `first-run:<id>`),
  - manual "Run now" (`web-app.server.ts:158`),
  - `reconcile-plan` from the billing page (`app.billing.tsx:27`) **and** from the `app_subscriptions/update` webhook — plan downgrades never reconcile,
  - uninstall's `queue.cancelWhere(...)` (`webhooks.server.ts:53`) — cannot see the worker's queues, so queued checks for an uninstalled shop are *not* cancelled, contradicting the COMPLIANCE.md stop-on-uninstall guarantee.
  Additionally, a worker restart changes its own prefix, orphaning any delayed `recheck` jobs sitting in Redis.
- **Why tests didn't catch it:** the queue contract suite (`packages/queue/test/queue-contract.test.ts:80`) constructs `BullMQDriver` with an explicit random prefix (bypassing the factory), auto-skips entirely without `REDIS_URL`, and never tests two driver instances sharing one Redis. The memory driver (a single shared in-process object) structurally cannot exhibit the bug. This is exactly the memory-vs-BullMQ contract-parity hole the plan warned about (§5.6).
- **Fix:** use a stable prefix (e.g. `checkoutwatch`, env-overridable `QUEUE_PREFIX` for test isolation) in `createJobQueue`; add a contract test that creates two `BullMQDriver` instances against the same Redis, `add`s on one and `process`es on the other, plus a `cancelWhere`-across-instances case; add the pre-prod Redis contract run to DEPLOYMENT.md §6 preflight (PLAN_REVIEW minor #9 asked for this).

### GAP-2 · MAJOR — Store-down detection silently degrades to "never alert" in production: control probe defaults to a localhost fixture and is documented as optional

- **Location:** `packages/core/src/env.ts:50` (`CONTROL_PROBE_URL` default `http://localhost:4602/health`), `packages/engine/src/runner.ts:150-160`, `docs/DEPLOYMENT.md` §5 ("Optional: ... control probe")
- **What's wrong:** PLAN_REVIEW B2's whole point was that a hard-down store must page. The engine implements the control-probe classification correctly, but the probe URL defaults to the *fixture's* control endpoint. In production nothing serves `localhost:4602/health` on the worker host, so the probe always fails, and a merchant store that is hard down (DNS/connect failure) classifies as `error`/`CONTROL_PROBE_FAILED` — which by design never opens an incident, never alerts, and is excluded from uptime. The inverted-taxonomy blocker re-enters through configuration. DEPLOYMENT.md lists the control probe under "Optional", so a by-the-book deploy ships blind to full outages.
- **Fix:** (a) in `env.ts`, when `NODE_ENV=production` reject a localhost `CONTROL_PROBE_URL` (same pattern as the `ENCRYPTION_KEY` production refinement); (b) default to a hosted known-good endpoint (or require it explicitly); (c) move it to the Required list in DEPLOYMENT.md §5 and add "store-down drill" to §6 preflight. Also worth noting: `STORE_UNREACHABLE` classification only triggers on the `visit_product` step (`runner.ts:146`); a store dying mid-run becomes `TIMEOUT_STEP_*` — still alertable, so acceptable, but document it.

### GAP-3 · MAJOR — Shopify webhook HMAC verification falls back to a publicly-known mock secret whenever `SHOPIFY_AUTH` isn't *literally* `"real"` — forgeable `shop/redact`/`app/uninstalled`

- **Location:** `apps/web/app/services/webhooks.server.ts:13-16`
- **What's wrong:** The route guard reads raw `process.env.SHOPIFY_AUTH === "real"`; otherwise it verifies HMACs against `"checkoutwatch-local-webhook-secret"` (a string committed to the repo and `.env.example`). But the rest of the app derives auth mode from *key presence* (`packages/core/src/env.ts:142-143`): an operator who sets `SHOPIFY_API_KEY`/`SECRET` but forgets the explicit `SHOPIFY_AUTH=real` gets a fully "real" app whose webhook endpoints accept signatures computed with the public default secret. An attacker could then POST a forged `shop/redact` (purges all shop data, `webhooks.server.ts:64`) or `app/uninstalled` (disables monitoring, deletes token). It also bypasses the "single source of env truth" rule (Phase 0: "later phases never read `process.env` directly").
- **Fix:** derive the mode from `getConfig().shopifyAuth` (already available via the runtime in every route), and in real mode require `shopifyApiSecret` or fail closed with 401. One-line change plus a test asserting mock-secret signatures are rejected when config resolves to real.

### GAP-4 · MAJOR — App-stack change log is half-inert in production: theme polling is hard-wired to `MockShopifyAdmin`

- **Location:** `apps/worker/src/main.ts:50-53` and `apps/web/app/services/runtime.server.ts:56-59` (`changePolling: { shopify: new MockShopifyAdmin(config.fixtureStorefrontUrl) }` — unconditional)
- **What's wrong:** PLAN.md feature #6 ("record when the store's installed apps/theme change") and Phase 4 promise `theme_updated` events from `ShopifyAdmin.getMainTheme()`. The real `GraphqlShopifyAdmin` (`packages/shopify/src/real.ts`) is only ever constructed inside request-scoped web auth (`auth.server.ts:65`); the worker's hourly `poll-store-changes` job always gets the mock, which returns a static fixture theme (`packages/shopify/src/mock.ts:28-36`) — so in production, `theme_updated` change events never fire and incident `changeContextJson` only ever contains script-origin diffs. This isn't a mock-standing-in-for-a-missing-credential (the credential *exists* in prod — the encrypted `Shop.accessToken` is stored precisely for offline API access, `auth.server.ts:49`); the wiring to use it was simply never built.
- **Fix:** add a worker-side `ShopifyAdminFactory` that, when `config.shopifyAuth === "real"`, decrypts `Shop.accessToken` and calls the Admin GraphQL endpoint directly (plain `fetch` with `X-Shopify-Access-Token`; the queries in `real.ts` are reusable as-is), falling back to the mock in mock mode. `poll-store-changes` already takes the port — only the factory and per-shop client construction are missing.

### GAP-5 · MAJOR — `CheckRun.triggeredBy` is overloaded as the job idempotency key; run provenance (`schedule|manual|recheck`) is silently discarded, and the idempotency lookup is an unindexed scan

- **Location:** `apps/worker/src/jobs/run-check.ts:41` (`jobKey = job:${context.id}`; `payload.trigger` never used), `packages/db/src/monitor-run-repository.ts:63,95,101`, schema `packages/db/prisma/schema.prisma:79` (`triggeredBy String @default("schedule")`)
- **What's wrong:** The plan (§2) defines `triggeredBy` as `schedule | manual | recheck`; the implementation stores `job:<queueJobId>` there instead and drops the `trigger` field carried in every payload. Consequences: (a) run history cannot distinguish a recheck from a scheduled run or a manual run — relevant for the dashboard, for debugging debounce behavior, and for the incident timeline; (b) `hasJobRun` + the `persistRun` idempotency re-check each do a `count` on `triggeredBy`, which has **no index** — two full `CheckRun` table scans per run, degrading linearly with retention on Postgres.
- **Fix:** add `jobKey String? @unique` to `CheckRun`, store the real trigger in `triggeredBy`, and use `jobKey` for both idempotency checks (the `@unique` also makes the create race-safe instead of count-then-create). Backfill migration is trivial since current values are self-identifying.

### GAP-6 · MAJOR — No Dockerfile / images / CI pipeline for a three-runtime deployment (web + Playwright worker + fixture-tested stack)

- **Location:** repo root (no `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or CI workflow anywhere); `docs/DEPLOYMENT.md` §5 prescribes bare-host installs ("Install Node 20+ and pnpm... `pnpm exec playwright install chromium` (plus the OS dependency command required by the target Linux image)")
- **Assessment — is this a real gap? Yes.** For a plain Node web app it would be a preference; for this system it's material: (a) the worker needs Chromium **plus ~30 OS shared libraries** that `playwright install` alone doesn't provide on a server image — hand-waved as "the OS dependency command" in the doc, and the Playwright version in the image must match `packages/engine`'s dependency or launches fail; (b) web and worker deploy separately with different needs (worker: browser + `ARTIFACT_DIR` volume + health port; web: none of that) — exactly what per-app images encode; (c) the repo's own guarantees (BullMQ contract vs real Redis, Postgres provider flip, `INLINE_WORKER=0` topology) are only testable in a multi-service environment that nothing in the repo can currently stand up; there is also no CI config, so "all tests green" is a local-only claim. Every prod-parity gap above (GAP-1, GAP-2) survived because this environment doesn't exist.
- **Fix:** two multi-stage Dockerfiles (worker `FROM mcr.microsoft.com/playwright:v<pinned-to-package.json>-jammy`, web from `node:20-slim`; shared pnpm-workspace build stage using `pnpm deploy --filter`), a `docker-compose.yml` with Postgres + Redis + web + worker + fixture for prod-parity smoke, and a CI workflow that runs lint/typecheck/test/engine/e2e plus the BullMQ contract suite against a Redis service container and a Postgres schema-flip migration check.

### GAP-7 · MINOR — `ARTIFACT_STORE=s3` is accepted and silently ignored; the planned S3 stub doesn't exist

- **Location:** `packages/core/src/env.ts:40` (enum `local|s3`), `packages/engine/src/artifact-store.ts` (only `LocalArtifactStore`); `config.artifactStore` is never read by `apps/worker/src/main.ts:28` or `runtime.server.ts:42` — both hard-code `LocalArtifactStore`.
- **What's missing vs planned:** §1.5 promised an "`S3ArtifactStore` stub for prod (env-gated)". Setting `ARTIFACT_STORE=s3` today silently writes to local disk — worst kind of config no-op. DEPLOYMENT.md is at least honest that multi-replica needs the adapter first.
- **Fix:** minimally, throw at boot when `artifactStore === "s3"` ("not implemented; use local with a persistent volume"); properly, add an S3-compatible adapter (the port is one `write` method) and a `read` method so `artifacts.$runId.$file.ts` (currently `readFile`-only, local-store-coupled) can stream from either store.

### GAP-8 · MINOR — Per-store frequency floor exists only as dead code; manual "Run now" is uncapped

- **Location:** `packages/engine/src/compliance.ts:29` (`enforceFrequencyFloor` — zero call sites outside tests), `apps/web/app/services/web-app.server.ts:153-163` (`runNow` enqueues with jobId `manual:<id>:<Date.now()>` — unique every click)
- **What's wrong:** COMPLIANCE.md states "Plan entitlements impose frequency floors." Scheduled runs are floored indirectly via `clampInterval`, but the helper written for the purpose is wired to nothing, and a merchant (or a stuck retry loop in a client) can click "Run now" arbitrarily fast — each click a real Chromium checkout walk against their store. The `runningAt` lock prevents *overlap*, not *rate*.
- **Fix:** in `runNow`, reject (or debounce to) requests within N seconds of `Monitor.lastRunAt` using `enforceFrequencyFloor`; surface a toast. ~15 lines plus a test.

### GAP-9 · MINOR — Debounce can be bypassed when failure *codes* change mid-streak (PRODUCT_UNAVAILABLE counts toward the checkout-incident streak)

- **Location:** `apps/worker/src/incident-machine.ts:67-96` with `packages/db/src/incident-repository.ts:247-258` (`countFailures` counts all `failed` runs including `PRODUCT_UNAVAILABLE`)
- **What's wrong:** Sequence sold-out (`failed`/PU) → transient `CHECKOUT_HTTP_5XX`: the second run computes `consecutiveFails = 2` (the PU run counted), skips the `=== 1` recheck branch, and opens a paging incident off a *single unconfirmed* checkout failure — the exact 3am-false-page class M2 existed to prevent. Narrow window, but the recheck-before-alert promise is the product's #1 stated constraint.
- **Fix:** exclude `PRODUCT_UNAVAILABLE` runs from `countFailures` (they have their own counter), or require the confirming run's code family to match the streak before opening. One-line change in `countFailures` + a table-driven machine test for the mixed sequence.

### GAP-10 · MINOR — Queue-driver housekeeping drift: memory dedupe map grows forever; BullMQ keeps completed jobs forever

- **Location:** `packages/queue/src/memory-driver.ts:24,35` (`knownIds` never evicted — every `jobId` ever enqueued is retained; long-lived `INLINE_WORKER` dev/web processes leak), `packages/queue/src/bullmq-driver.ts:22-29` (no `removeOnComplete`/`removeOnFail` — completed/failed jobs accumulate in Redis unboundedly in prod)
- **Fix:** evict memory-driver dedupe keys on job completion past a TTL/cap; set `removeOnComplete: { age, count }` and `removeOnFail: { age }` defaults in the BullMQ driver (keeping failed jobs long enough to serve as the dead-letter record ARCHITECTURE.md leans on). Note the semantic wrinkle: BullMQ jobId-dedupe only lasts while the job exists, memory dedupe currently lasts forever — pick one contract, encode it in the contract suite.

### GAP-11 · MINOR — Dashboard response-time sparkline includes `error`-run durations

- **Location:** `apps/web/app/services/web-app.server.ts:63-66` (filters only `durationMs !== null`); contrast `status-page.server.ts:181-187` which correctly restricts to `passed|failed`
- **What's wrong:** A slow engine-side failure (e.g. watchdog/browser error) pollutes the merchant's latency trend — a mild breach of the "our bugs never dent merchant stats" rule that uptime math gets right everywhere.
- **Fix:** apply the same `passed|failed` filter as the status page (and ideally extract one shared helper — `aggregateUptime` and `availability` are already near-duplicates across these two files).

---

## (B) Recommended Next Steps

### 1. Production-correctness patch: queue prefix + control probe + webhook secret (Effort: S — highest value/effort in the repo)
Fix GAP-1 (stable `QUEUE_PREFIX`), GAP-2 (production env refinement rejecting localhost probe URL; DEPLOYMENT.md "Required"), GAP-3 (webhook secret from `getConfig()`, fail-closed). Three small diffs in `packages/queue/src/index.ts`, `packages/core/src/env.ts`, `apps/web/app/services/webhooks.server.ts`, plus a cross-instance BullMQ contract test. Until this lands, the first real deployment loses web-originated jobs, can't page on a hard-down store, and exposes forgeable data-purge webhooks — everything else is polish by comparison.

### 2. Containerize and add CI with a prod-parity lane (Effort: M)
Closes GAP-6 and structurally prevents GAP-1/GAP-2-class regressions: worker image on the version-pinned Playwright base, web image, `docker-compose.yml` (Postgres + Redis + both apps + fixture), CI running the full suite plus BullMQ contract against a Redis service and the Postgres provider-flip migration. This converts DEPLOYMENT.md from prose into an executable artifact and gives the repo its first environment where `INLINE_WORKER=0` web→Redis→worker actually runs before a customer does it.

### 3. Real offline Shopify Admin access in the worker → make the app-stack change log real (Effort: M)
Closes GAP-4. Build the token-decrypting per-shop Admin client factory in `apps/worker` (queries already exist in `packages/shopify/src/real.ts`), select it by `config.shopifyAuth`, and add a fake-fetch unit test. This activates the `theme_updated` half of PLAN.md feature #6 — the "what changed right before" differentiator that currently only ships script-origin diffs — and the same factory is the natural seam for future product-availability pre-checks.

### 4. Run provenance + idempotency hygiene (Effort: S)
Closes GAP-5 and improves the money page: `CheckRun.jobKey @unique` for idempotency, restore `triggeredBy` semantics, and show "scheduled / re-check / manual" badges in `app.monitors.$id.tsx` run history and the incident timeline (a recheck-confirmed failure reads far more trustworthy to a merchant — it *demonstrates* the false-positive control the product sells). Include the GAP-9 one-liner in `countFailures` while touching this area.

### 5. Compliance/UX seams: run-now floor, artifact-store fail-fast, stat hygiene (Effort: S)
Bundle the small keep-the-promises items: wire `enforceFrequencyFloor` into `runNow` (GAP-8), boot-fail on unimplemented `ARTIFACT_STORE=s3` (GAP-7), exclude error runs from the dashboard sparkline and dedupe the two uptime helpers (GAP-11), and add queue-driver retention defaults (GAP-10). Individually trivial; together they close every remaining daylight between COMPLIANCE.md/ARCHITECTURE.md claims and code behavior.
