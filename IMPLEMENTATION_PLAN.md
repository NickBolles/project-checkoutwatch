# CheckoutWatch — Phased Implementation Plan

> Engineer-ready build plan derived from `PLAN.md` / `README.md`. Each phase is self-contained
> and executable by one coding agent **without any live external credentials**. Every external
> service sits behind an adapter with a local mock/test double; real creds drop in later via env vars.
>
> Sibling project: `C:\Users\nickb\Code\alertproof` — the alert-delivery layer here is deliberately
> built to AlertProof's shape (channel adapters + delivery log + dispatcher + "test my alerts")
> so the package is portable between the two apps (~30% shared code per PLAN.md).

---

## 1. Architecture Decisions

### 1.1 Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere (Node 20+) | One language across web/worker/packages; Shopify template is TS |
| Embedded app | **Shopify React Router 7 template shape** (`@shopify/shopify-app-react-router`) + Polaris | PLAN.md says "Remix"; Remix merged into React Router v7 and Shopify's current recommended template is `shopify-app-template-react-router`. Same architecture, current package. |
| Browser tests | Playwright, headless Chromium | Real, runnable locally with zero creds |
| Queue | BullMQ on Redis, behind a `JobQueue` interface with an **in-memory driver fallback** | Agents have no Redis; `QUEUE_DRIVER=memory` runs the whole pipeline in-process |
| DB | Prisma. **SQLite for dev/test** (`file:./dev.db`, matches Shopify template default), Postgres in prod | Agents have no Postgres. Schema kept provider-portable (see 1.6) |
| AI diagnosis | `@anthropic-ai/sdk` behind a `Diagnoser` interface; deterministic `HeuristicDiagnoser` fallback | Model via `LLM_MODEL` env (default `claude-opus-4-8`); no key → heuristic |
| Email | Resend behind `AlertChannelAdapter` (Postmark swap documented) | Mirrors AlertProof |
| SMS | Twilio behind `AlertChannelAdapter` (Pro tier only) | Mirrors AlertProof |
| Slack/Discord | Incoming-webhook adapters (per-merchant URLs — no global creds) | Mirrors AlertProof; testable against a local webhook sink |
| Monorepo | pnpm workspaces | Clean package boundaries; `packages/alerts` lifts out for AlertProof |
| Tests | Vitest (unit/integration), Playwright (engine + E2E) | |
| Validation | zod (env validation, LLM output validation, route inputs) | |
| Logging | pino, structured | |

### 1.2 Repository layout

```
checkoutwatch/
  package.json                 # pnpm workspaces root; shared scripts
  pnpm-workspace.yaml
  .env.example                 # every var below, documented
  packages/
    db/                        # @checkoutwatch/db — Prisma schema, client, JSON-column helpers
    core/                      # @checkoutwatch/core — env config (zod), domain types, plans/entitlements, logger, crypto
    alerts/                    # @checkoutwatch/alerts — AlertProof-shaped delivery layer (portable; see 1.4)
    engine/                    # @checkoutwatch/engine — Playwright checkout runner + artifact capture
    diagnosis/                 # @checkoutwatch/diagnosis — Diagnoser interface, heuristic + Anthropic adapters
    queue/                     # @checkoutwatch/queue — JobQueue interface, BullMQ + memory drivers, scheduler
    shopify/                   # @checkoutwatch/shopify — ShopifyAdmin + Billing adapters, real + mock impls
  apps/
    web/                       # Shopify embedded app (React Router 7 + Polaris) + public status page
    worker/                    # worker process: queue consumers + scheduler tick
  fixtures/
    storefront/                # local mock Shopify storefront w/ switchable failure modes (Express)
    webhook-sink/              # tiny HTTP server that records POSTs (Slack/Discord/webhook tests)
  docs/
    COMPLIANCE.md              # bot etiquette: UA, frequency caps, allowlisting, Shopify automated-traffic rules
    ARCHITECTURE.md            # generated in Phase 9 from this plan + reality
    DEPLOYMENT.md              # prod credential drop-in guide (Postgres, Redis, Shopify Partner, providers)
  var/                         # gitignored runtime data: artifacts/, dev.db, outbox/
```

### 1.3 Worker / queue design

- **`JobQueue` interface** (`packages/queue`): `add(name, payload, opts)`, `process(name, handler, {concurrency})`, retry/backoff options. Two drivers:
  - `BullMQDriver` — real BullMQ against `REDIS_URL`.
  - `MemoryDriver` — in-process FIFO with `setTimeout` delays and retry/backoff semantics matching the interface contract (shared contract test suite runs against both drivers).
  - Selected by `QUEUE_DRIVER=bullmq|memory` (default `memory` when `REDIS_URL` unset).
- **Scheduler**: a 30s tick (in `apps/worker`) queries `Monitor` where `enabled && nextRunAt <= now`, enqueues `run-check` jobs, and advances `nextRunAt = now + intervalMinutes` (interval clamped by plan entitlement). DB-driven scheduling instead of BullMQ repeatable jobs → identical behavior on both queue drivers, and no repeatable-job sprawl per monitor.
  - **Atomic claim (no double-scheduling)**: each due monitor is claimed with a conditional `updateMany` (`WHERE id = ? AND nextRunAt = <value read>` advancing `nextRunAt`; affected-rows = 1 required before enqueue). Two concurrent schedulers (second worker, or `INLINE_WORKER=1` web + `pnpm worker` running together) then cannot both enqueue the same run. Belt-and-suspenders on BullMQ: `jobId = ${monitorId}:${nextRunAtEpoch}` so duplicate adds dedupe. Dev rule: `INLINE_WORKER=1` and a separate `pnpm worker` are mutually exclusive — document in README.
  - **Per-monitor in-flight guard (no overlapping runs)**: `run-check`/`recheck` handlers conditionally set `Monitor.runningAt` (conditional update, null → now) before executing; if already set (and younger than a stale-lock timeout, default 5 min), the job exits as `skipped`. Cleared in a `finally`. A slow run + short interval, or a recheck racing the next scheduled run, can therefore never interleave and corrupt `consecutiveFails`/debounce state.
  - **At-least-once semantics**: BullMQ may redeliver; all job handlers must be idempotent, and the queue contract suite includes a duplicate-delivery case (same job delivered twice → observable effect happens once).
- **Job types**: `run-check` (execute a checkout test), `recheck` (debounce confirmation run), `dispatch-alert` (send one alert message through the alerts package), `poll-store-changes` (theme/app-stack change detection, hourly per shop).
- Playwright concurrency capped per worker (`ENGINE_CONCURRENCY`, default 2); one Chromium browser instance reused across runs with fresh contexts per run.
- `apps/worker` is a single entrypoint (`pnpm worker`) that starts queue processors + scheduler; in dev, `apps/web` can also boot the memory-queue worker in-process (`INLINE_WORKER=1`) so one command runs everything.

### 1.4 Alert-delivery layer — mirrors AlertProof

AlertProof's spec (see `alertproof/IMPLEMENTATION_PLAN.md` §1.2, §1.4, §2): per-provider ports that own **both send and status-webhook handling** (`EmailProvider.{send, verifyStatusWebhook, parseStatusEvent}`, `SmsProvider.{send, parseStatusCallback}`), an 8-state delivery vocabulary (`PENDING|SENDING|SENT|DELIVERED|BOUNCED|DEFERRED|FAILED|SKIPPED`), and a **claim-based dispatcher** (conditional UPDATE `PENDING→SENDING`, affected-rows = 1, before any provider call — crash- and concurrency-safe). CheckoutWatch's `packages/alerts` is built to a **portability contract** both repos can satisfy — review finding B1: the earlier draft (send-only adapters, 5-state vocabulary, in-memory fan-out, mapper-only webhooks) was *not* drop-in compatible with AlertProof and would have broken the ~30% reuse bet.

```ts
type ChannelType = 'email' | 'slack' | 'discord' | 'sms';

// Superset of both apps' needs; maps 1:1 onto AlertProof's enum (queued=PENDING, etc.)
type DeliveryStatus =
  | 'queued' | 'sending' | 'sent' | 'delivered'
  | 'bounced' | 'deferred' | 'failed' | 'skipped';   // 'skipped' = plan-gated route, logged honestly

interface AlertMessage {
  key: string;                 // idempotency key (e.g. `incident:${id}:opened`)
  event: string;               // 'incident_opened' | 'incident_resolved' | 'test' | (AlertProof: 'order_created' ...)
  subject: string;             // email subject / SMS prefix
  bodyText: string;
  bodyHtml?: string;
  meta?: Record<string, unknown>;
}

interface DeliveryResult {
  status: 'sent' | 'delivered' | 'failed';  // sync-confirmed channels (Slack/Discord) return 'delivered'
  providerMessageId?: string;
  error?: string;
}

interface AlertChannelAdapter {
  readonly type: ChannelType;
  send(destination: string, message: AlertMessage): Promise<DeliveryResult>;
  // Provider status callbacks are owned by the adapter (mirrors AlertProof's
  // EmailProvider.verifyStatusWebhook/parseStatusEvent) — optional because
  // webhook-post channels (slack/discord) have none:
  verifyStatusWebhook?(headers: Record<string, string>, rawBody: string): boolean;
  parseStatusEvent?(payload: unknown): { providerMessageId: string; status: DeliveryStatus; detail?: string } | null;
}

interface DeliveryLogStore {                  // persistence port — app supplies Prisma impl
  record(entry: DeliveryLogEntry): Promise<string>;
  // Claim/transition primitives so the dispatcher is crash- and concurrency-safe
  // and AlertProof's Postgres SKIP LOCKED implementation satisfies the same port:
  claimQueued(limit: number): Promise<DeliveryLogEntry[]>;           // queued → sending, atomically
  transition(id: string, from: DeliveryStatus, to: DeliveryStatus, detail?: string): Promise<boolean>; // conditional; false = lost race
  updateStatus(id: string, status: DeliveryStatus, detail?: string): Promise<void>; // provider-webhook path (by providerMessageId lookup in app layer)
}

class AlertDispatcher {
  // fan out one AlertMessage to a list of {channel, destination} routes:
  // write one 'queued' DeliveryLogEntry per route (dedupe on message.key + route),
  // claim (queued→sending via transition), call adapter, mark sent/delivered/failed,
  // retry with backoff (attempts on the entry), entitlement-blocked routes recorded as 'skipped'.
}
```

- **Adapters**: `ResendEmailAdapter`, `SlackWebhookAdapter`, `DiscordWebhookAdapter`, `TwilioSmsAdapter`, and `MockAdapter` (any type; appends JSON lines to `var/outbox/<type>.jsonl` and logs). `ALERT_TRANSPORT=mock|real` (default `mock` when provider keys are unset). Additionally, any destination beginning `mock://` always routes to the mock adapter regardless of transport — AlertProof's convention, adopted for parity and used by tests.
- **Email is provider-plural by interface**: CheckoutWatch ships `ResendEmailAdapter`; AlertProof uses Postmark. Both are implementations of the same `AlertChannelAdapter('email')` surface (send + verify + parse), so swapping providers is an adapter swap, not an interface change. A `PostmarkEmailAdapter` is *not* built here — the contract just guarantees it slots in.
- **Provider status webhooks** (Resend delivery/bounce events, Twilio status callbacks) go: HTTP route in `apps/web` → `adapter.verifyStatusWebhook` (signature check inside the package) → `adapter.parseStatusEvent` → delivery-log update by `providerMessageId`. Same "proof of delivery" moat AlertProof sells; out-of-order events must not regress a terminal `delivered` (AlertProof rule, kept).
- The package depends only on the `DeliveryLogStore` port, `fetch`, and provider SDKs — **no Prisma/Shopify imports** — so it can be dropped into AlertProof unchanged.
- **`packages/alerts/README.md` is the canonical cross-repo parity contract.** It records the interface surface above, the status-vocabulary mapping to AlertProof's enum, and a reconciliation note: AlertProof's implementation plan predates this contract and should adopt these interface names (`AlertChannelAdapter`, `DeliveryLogStore`, `AlertDispatcher`) when its Phase 3 is built, keeping its Postgres SKIP-LOCKED claim as the `DeliveryLogStore` implementation detail.
- "Test my alerts" (AlertProof's sales-closing button) is reused verbatim: fire a fake incident through the whole dispatcher from the settings UI.

### 1.5 Checkout-test engine — how tests are generated from a product pick

No-code setup means a `Monitor` row *is* the test definition; there is no per-merchant script:

```ts
interface CheckoutTestDefinition {
  storeUrl: string;           // https://shop.example.com  (fixture: http://localhost:4600)
  productHandle: string;      // picked from a dropdown (ShopifyAdmin.listProducts)
  variantId?: string;
  timeoutMs: number;          // per-step budget
}
```

`CheckoutRunner.run(def): CheckRunResult` executes fixed steps with **assertion-level** (not pixel) checks, each with resilient selector strategies documented inline:

1. **visit_product** — `GET {storeUrl}/products/{handle}`; assert HTTP < 400 and an add-to-cart form exists (`form[action*="/cart/add"]` OR `button[name="add"]` OR `[data-testid*="add"]`; fallback: POST `/cart/add.js` with variant id — API-level check when themes hide the form).
2. **add_to_cart** — submit the form (or `/cart/add.js`); assert cart count > 0 via `/cart.js`.
3. **go_to_checkout** — navigate to `/checkout`; follow redirects; assert we land on a checkout page (URL contains `/checkouts/` or `/checkout`, HTTP < 400).
4. **assert_payment_step** — assert checkout shell rendered: contact/email input present (`input[type="email"], input[name*="email"]`), and a payment indicator exists (payment section landmark, card fields iframe from a known payment origin, or text markers; the known-payment-origin list is config data, updatable without a deploy). **Stop before payment. Never submit payment — and never enter any data into any checkout field** (no email, no address, no card): assertions are presence/visibility checks only, so runs can never create contactable abandoned checkouts or trigger recovery emails.

**Run outcome taxonomy (three-way, defined here — not deferred):** every run resolves to `passed | failed | error`.
- `failed` = the merchant's checkout is broken (alertable): assertion failures, checkout 5xx, payment iframe missing, timeouts on the store's pages, and **`STORE_UNREACHABLE`** (DNS/connect/TLS failure to the merchant origin *confirmed by a control probe* — the runner fetches a known-good control endpoint; control OK ⇒ the merchant is down ⇒ real failure).
- `error` = we could not judge the checkout (never alertable to the merchant; ops-flagged internally): browser/launch crashes, runner bugs, control probe also failing (our network), and **`BOT_CHALLENGE`** (challenge/captcha page detected — classified, never bypassed or retried aggressively; surfaced to the merchant as a setup issue with allowlisting instructions).
- **`PRODUCT_UNAVAILABLE`** (product 404 / variant sold out — detected via product JSON or `/cart/add.js` 422) is a distinct `failed`-family code that the incident machine routes to a "monitor needs attention" notification instead of a checkout incident (see Phase 5) — a sold-out product must never page a merchant "checkout broken" at 3am.

Captured on every run (always, not just failures): per-step timings, total duration, HTTP status per navigation, and the **set of third-party script origins** loaded (input to the app-stack change log). Console/network/script-origin collectors are **attached at context creation**, before step 1 — capture is buffered for the whole run and persisted on failure (attaching at failure time would miss everything). On failure additionally persisted: full-page screenshot (best-effort — a crashed navigation may yield none), console messages (warn+error), failed network requests (status ≥ 400 or aborted), failing step + normalized error code (`ADD_TO_CART_NOT_FOUND`, `CHECKOUT_HTTP_5XX`, `PAYMENT_IFRAME_MISSING`, `TIMEOUT_STEP_X`, `STORE_UNREACHABLE`, `PRODUCT_UNAVAILABLE`, `BOT_CHALLENGE`, ...).

Etiquette baked in: identified UA `CheckoutWatchBot/1.0 (+https://checkoutwatch.app/bot)`, per-store frequency floor, `Accept-Language` fixed, no retries inside a run, robots.txt fetched and logged. **Authorization model (COMPLIANCE.md):** tests run only against stores whose merchant installed the app, only against the configured storefront URL, and stop immediately on uninstall — the documented basis is merchant-consented synthetic monitoring, not crawling (Shopify's standard robots.txt disallows `/checkout`, so a blanket "we obey robots.txt" claim is impossible; state the consent position honestly instead). COMPLIANCE.md + merchant docs also cover synthetic-traffic side effects: analytics exclusion guidance (identified UA, published egress IPs, GA/Shopify bot-filter notes) and the no-abandoned-checkout-email guarantee (no form data is ever entered).

**Artifacts** go through an `ArtifactStore` port: `LocalArtifactStore` (writes under `var/artifacts/{runId}/`) now; `S3ArtifactStore` stub for prod (env-gated, not needed to build).

**Local fixture storefront** (`fixtures/storefront`): an Express app mimicking the Shopify storefront surface — `/products/:handle` (HTML with theme-like add-to-cart form), `/cart/add.js`, `/cart.js`, `/checkout` (HTML with email input + fake payment iframe) — with switchable modes via `POST /__mode {mode}` or `?__mode=`: failure modes `add_to_cart_broken`, `checkout_500`, `payment_iframe_missing`, `slow_checkout`, `sold_out` (variant unavailable → `PRODUCT_UNAVAILABLE`), `bot_challenge` (serves a challenge page → `BOT_CHALLENGE`/error); plus observation modes `ok`, `console_error`, `third_party_script_added` — the latter two must still **pass** (assertion-level promise: a console error alone is data for diagnosis, not a failure). Store-down is simulated by stopping the fixture listener (with the control endpoint still up → `STORE_UNREACHABLE`). This is the engine's test target, the E2E target, and the demo ("break my store deliberately").

### 1.6 External-service abstraction (the adapter map)

| Service | Port (interface) | Real impl | Local double | Switch |
|---|---|---|---|---|
| Shopify Admin API | `ShopifyAdmin` (`listProducts`, `getShop`, `getMainTheme`) | GraphQL Admin via app session | `MockShopifyAdmin` — fixture products whose `storeUrl` points at `fixtures/storefront` | `SHOPIFY_AUTH=mock` |
| Shopify OAuth/embed | `authenticate()` wrapper around template auth | `@shopify/shopify-app-react-router` | mock session for `dev-shop.myshopify.com`, embed bypass | `SHOPIFY_AUTH=mock` |
| Shopify Billing | `BillingAdapter` (`ensureSubscription`, `getActivePlan`) | Billing GraphQL (`appSubscriptionCreate`) | `MockBilling` — instant approval, plan stored on Shop row | `SHOPIFY_AUTH=mock` |
| Redis/BullMQ | `JobQueue` | `BullMQDriver` | `MemoryDriver` | `QUEUE_DRIVER` |
| Postgres | Prisma | `provider="postgresql"` | SQLite `file:./var/dev.db` | `DATABASE_URL` (+ see note) |
| LLM | `Diagnoser` | `AnthropicDiagnoser` | `HeuristicDiagnoser` (also the fallback on API error) | `DIAGNOSIS_PROVIDER` / key presence |
| Email | `AlertChannelAdapter('email')` | Resend | `MockAdapter` → `var/outbox/email.jsonl` | `ALERT_TRANSPORT` |
| SMS | `AlertChannelAdapter('sms')` | Twilio | `MockAdapter` | `ALERT_TRANSPORT` |
| Slack/Discord | webhook adapters | real webhook URLs (merchant data, not env) | `fixtures/webhook-sink` URLs in tests | destination URL itself |
| Artifact storage | `ArtifactStore` | S3 (stub) | local disk | `ARTIFACT_STORE` |

**Prisma provider note**: Prisma pins `provider` in the schema. Keep `schema.prisma` on `sqlite` for the whole build; write the schema portable — **no `Json` columns** (SQLite-unsupported): JSON payloads are `String` columns with typed (de)serializer helpers in `packages/db`; no enums-with-`@db.` attributes; ids are `cuid()` strings. `docs/DEPLOYMENT.md` (Phase 9) documents the prod switch: flip provider to `postgresql`, regenerate migrations (`prisma migrate diff`), run against real `DATABASE_URL`. This is a one-time mechanical step and is the only piece deferred to credential-time. At the Postgres flip, additionally add a native partial unique index (`CREATE UNIQUE INDEX ... ON "Incident"(monitorId) WHERE status = 'open'`) as defense-in-depth behind `Monitor.openIncidentId`.

### 1.7 Testing approach

- **Unit** (Vitest): pure logic — entitlements, debounce state machine, heuristic diagnoser rules, script-origin diff, dispatcher routing/dedupe.
- **Contract tests**: one shared suite run against both `JobQueue` drivers; one shared suite for every `AlertChannelAdapter` against the webhook sink / outbox.
- **Engine integration** (Playwright, tagged `@engine`): `CheckoutRunner` against `fixtures/storefront` in every failure mode; asserts result codes + artifact capture.
- **Pipeline E2E** (tagged `@e2e`): boot fixture storefront + memory queue + mock adapters + SQLite; create a monitor via service layer; flip fixture to broken; assert (fail → recheck → incident → diagnosis → alert rows in delivery log → resolve on fix). This is the acceptance backbone for Phases 3–5.
- **Web** : route loader/action tests with mock auth; minimal Playwright smoke on key pages (`SHOPIFY_AUTH=mock` renders Polaris outside the Shopify iframe).
- CI-ish root scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:engine`, `pnpm test:e2e` — all green with **zero** external creds.

---

## 2. Data Model (Prisma)

All `*Json` fields are `String` columns holding JSON (portable SQLite↔Postgres; typed accessors in `packages/db`).

```prisma
model Shop {
  id             String   @id @default(cuid())
  shopDomain     String   @unique            // dev-shop.myshopify.com
  storefrontUrl  String                       // base URL tests run against (fixture URL in dev)
  accessToken    String?                      // encrypted with ENCRYPTION_KEY
  plan           String   @default("free")    // free | growth | pro
  settingsJson   String   @default("{}")      // timezone, notification prefs
  installedAt    DateTime @default(now())
  uninstalledAt  DateTime?
  monitors       Monitor[]
  channels       AlertChannelConfig[]
  deliveries     AlertDelivery[]
  changeEvents   StoreChangeEvent[]
  statusPage     StatusPage?
  subscription   BillingSubscription?
}

model Session {           // Shopify template session storage (shape required by the template)
  id          String  @id
  shop        String
  state       String
  isOnline    Boolean @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?
}

model Monitor {
  id               String   @id @default(cuid())
  shopId           String
  shop             Shop     @relation(fields: [shopId], references: [id])
  name             String
  productHandle    String
  productTitle     String
  variantId        String?
  intervalMinutes  Int      @default(15)      // clamped by plan entitlement
  enabled          Boolean  @default(true)
  nextRunAt        DateTime @default(now())
  runningAt        DateTime?                  // per-monitor in-flight lock (§1.3); stale after 5 min
  lastRunAt        DateTime?
  lastStatus       String?                    // passed | failed | error
  consecutiveFails Int      @default(0)
  consecutiveErrors Int     @default(0)       // engine-error streak → internal ops flag, never merchant alerts
  openIncidentId   String?  @unique           // set atomically on incident open — schema-level guarantee of
                                              // one open incident per monitor, portable SQLite↔Postgres
  runs             CheckRun[]
  incidents        Incident[]
  @@index([enabled, nextRunAt])
  @@index([shopId])                           // Prisma does not auto-index FK scalars
}

model CheckRun {
  id                String   @id @default(cuid())
  monitorId         String
  monitor           Monitor  @relation(fields: [monitorId], references: [id])
  status            String                    // passed | failed | error | skipped
  triggeredBy       String   @default("schedule") // schedule | manual | recheck
  startedAt         DateTime
  finishedAt        DateTime?
  durationMs        Int?
  stepTimingsJson   String   @default("[]")   // [{step, ms, httpStatus}]
  failureStep       String?
  failureCode       String?                   // normalized: PAYMENT_IFRAME_MISSING, ...
  failureMessage    String?
  screenshotPath    String?                   // ArtifactStore key
  consoleJson       String   @default("[]")
  failedRequestsJson String  @default("[]")
  scriptOriginsJson String   @default("[]")   // third-party script origins seen this run
  @@index([monitorId, startedAt])
}

model Incident {
  id               String   @id @default(cuid())
  monitorId        String
  monitor          Monitor  @relation(fields: [monitorId], references: [id])
  status           String   @default("open")  // open | resolved
  openedAt         DateTime @default(now())
  resolvedAt       DateTime?
  reopenCount      Int      @default(0)       // flap suppression: re-fail within cooldown reopens this row
  openingRunId     String
  resolvingRunId   String?
  failureCode      String                     // from the *confirming* (recheck) run
  diagnosisJson    String?                    // {summary, probableCause, evidence[], confidence, provider, model}
  changeContextJson String  @default("[]")    // StoreChangeEvents in window before incident ("what changed right before")
  @@index([monitorId, status])
}

model AlertChannelConfig {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  type        String                          // email | slack | discord | sms
  destination String                          // address / webhook URL / E.164 phone
  enabled     Boolean  @default(true)
  verifiedAt  DateTime?
  @@unique([shopId, type, destination])
}

model AlertDelivery {                         // the delivery log — AlertProof shape
  id                String   @id @default(cuid())
  shopId            String
  shop              Shop     @relation(fields: [shopId], references: [id])
  incidentId        String?
  messageKey        String                    // idempotency key
  event             String                    // incident_opened | incident_resolved | test
  channelType       String
  destination       String
  status            String                    // queued | sending | sent | delivered | bounced | deferred | failed | skipped (§1.4 superset vocabulary)
  providerMessageId String?
  errorDetail       String?
  attempts          Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([shopId, createdAt])
  @@index([providerMessageId])                // join key for Resend/Twilio status webhooks
  @@index([incidentId])
  @@unique([messageKey, channelType, destination])
}

model StoreChangeEvent {                      // app-stack change log
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  detectedAt  DateTime @default(now())
  kind        String                          // theme_updated | script_added | script_removed
  detailJson  String                          // {themeId?, origin?, monitorId?}
  @@index([shopId, detectedAt])
}

model BillingSubscription {
  id                    String   @id @default(cuid())
  shopId                String   @unique
  shop                  Shop     @relation(fields: [shopId], references: [id])
  plan                  String
  shopifySubscriptionId String?               // null under MockBilling
  status                String                // pending | active | cancelled
  activatedAt           DateTime?
}

model StatusPage {
  id        String  @id @default(cuid())
  shopId    String  @unique
  shop      Shop    @relation(fields: [shopId], references: [id])
  slug      String  @unique
  title     String
  enabled   Boolean @default(false)           // Pro entitlement
}
```

Plan entitlements (code, `packages/core/plans.ts`, not DB):

| | free | growth ($19) | pro ($49) |
|---|---|---|---|
| monitors | 1 | 3 | 10 |
| min interval | 60 min | 10 min | 5 min |
| channels | email | email+slack+discord | all incl. SMS |
| AI diagnosis | ✗ (heuristic only) | ✓ | ✓ |
| public status page | ✗ | ✗ | ✓ |

---

## 3. Env Vars / External Credentials

**Nothing blocks the local build.** "Blocking" below = required before *production launch*; every row has a working local fallback that the default `.env.example` selects automatically.

| Var | Used by | Prod-blocking? | Local mock / fallback |
|---|---|---|---|
| `DATABASE_URL` | all | Yes (Postgres) | default `file:./var/dev.db` (SQLite) |
| `REDIS_URL` | queue | Yes | unset → `QUEUE_DRIVER=memory` |
| `QUEUE_DRIVER` | queue | — | `memory` (default) / `bullmq` |
| `SHOPIFY_API_KEY` | web | Yes | `SHOPIFY_AUTH=mock` bypasses OAuth entirely |
| `SHOPIFY_API_SECRET` | web | Yes | " |
| `SHOPIFY_APP_URL` | web | Yes | `http://localhost:3000` |
| `SHOPIFY_SCOPES` | web | Yes | constant `read_products,read_themes` |
| `SHOPIFY_AUTH` | web | — | `mock` (default) / `real` |
| `ANTHROPIC_API_KEY` | diagnosis | No (feature-gated) | unset → `HeuristicDiagnoser` |
| `LLM_MODEL` | diagnosis | — | default `claude-opus-4-8` |
| `DIAGNOSIS_PROVIDER` | diagnosis | — | `heuristic` (default) / `anthropic` |
| `RESEND_API_KEY` | alerts/email | Yes | unset → `ALERT_TRANSPORT=mock` → `var/outbox/email.jsonl` |
| `RESEND_WEBHOOK_SECRET` | alerts | Yes | mock: delivery status auto-advances |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | alerts/sms | Yes (Pro SMS only) | mock adapter |
| `ALERT_TRANSPORT` | alerts | — | `mock` (default) / `real` |
| `ARTIFACT_STORE` / `ARTIFACT_DIR` | engine | No | `local` / `var/artifacts` |
| `ENCRYPTION_KEY` | core | Yes (generate at deploy) | dev key auto-generated into `.env` on first run |
| `ENGINE_CONCURRENCY` | worker | — | `2` |
| `INLINE_WORKER` | web dev | — | `1` in dev |
| `FIXTURE_STOREFRONT_URL` | mock shopify / tests | — | `http://localhost:4600` |

Slack/Discord webhook URLs are **merchant data** (per-channel `destination`), never env vars — tested against `fixtures/webhook-sink`.

Tally: **0 vars block the build; 11 are production-blocking (4 Shopify + DB + Redis + 2 Resend + 3 Twilio); everything else is optional/mockable. `ANTHROPIC_API_KEY` is mockable even in prod (heuristic fallback).**

---

## 4. Phases

Order: scaffold → alerts (AlertProof mirror) → engine → queue/scheduler → failure capture + AI diagnosis → debounce/alerting → embedded UI → billing → status page → hardening. Each phase leaves `pnpm lint && pnpm typecheck && pnpm test` green.

---

### Phase 0 — Scaffold, config, database

**Goal**: pnpm monorepo with all package skeletons, validated env config, Prisma schema migrated on SQLite, logging, and root scripts. Everything after this phase drops into a working harness.

**Files**
- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.env.example`, `eslint`/`prettier` config, `vitest.workspace.ts`
- `packages/core/`: `src/env.ts` (zod-validated config with the defaults from §3 — the single source of env truth), `src/plans.ts` (entitlements table + `clampInterval`, `canUseChannel`, `maxMonitors`), `src/logger.ts` (pino), `src/crypto.ts` (AES-GCM encrypt/decrypt for tokens; dev key autogen), `src/types.ts`
- `packages/db/`: `prisma/schema.prisma` (full §2 schema), `src/client.ts`, `src/json.ts` (typed JSON-column serializers, e.g. `readStepTimings(run)`), `src/seed.ts` (dev shop + one monitor pointing at fixture URL)
- Empty-but-compiling skeletons with `index.ts` + one placeholder test for: `alerts`, `engine`, `diagnosis`, `queue`, `shopify`, `apps/worker`
- `apps/web/`: placeholder only (real scaffold in Phase 6)

**Key notes**: schema is written provider-portable per §1.6 (no `Json`, no db-native enums). `env.ts` derives mode flags (`queueDriver`, `alertTransport`, `diagnosisProvider`, `shopifyAuth`) from key presence so later phases never read `process.env` directly.

**External deps/env**: none. SQLite file DB.

**Tests**: env parser (defaults, override, bad-value rejection); entitlement functions; crypto round-trip; `prisma migrate dev` runs + seed inserts + a smoke query via the client.

**Acceptance criteria**
- `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm test` succeeds on a clean Windows checkout with no `.env`.
- `pnpm typecheck` covers every workspace package.

---

### Phase 1 — Alert-delivery package (AlertProof-shaped)

**Goal**: `@checkoutwatch/alerts` complete: channel adapters, dispatcher, delivery-log port, retry/idempotency, provider-webhook status ingestion — portable to AlertProof unchanged.

**Files**
- `packages/alerts/src/types.ts` — the §1.4 interfaces (`AlertMessage`, `AlertChannelAdapter` incl. `verifyStatusWebhook`/`parseStatusEvent`, `DeliveryResult`, `DeliveryLogStore` incl. `claimQueued`/`transition`, the 8-state `DeliveryStatus`)
- `packages/alerts/src/adapters/email-resend.ts`, `slack.ts`, `discord.ts`, `sms-twilio.ts`, `mock.ts` — Resend and Twilio adapters implement `verifyStatusWebhook` (signature check) + `parseStatusEvent`; `mock://` destinations always route to `mock.ts`
- `packages/alerts/src/dispatcher.ts` — fan-out: one `queued` log row per route (dedupe on `(messageKey, channel, destination)`), claim via `transition('queued','sending')` before each provider call, mark `sent`/`delivered`/`failed`, retry w/ exponential backoff (max 3), entitlement-blocked routes recorded as `skipped`
- `packages/alerts/src/status-webhooks.ts` — thin glue: raw request → adapter `verifyStatusWebhook` → `parseStatusEvent` → log update by `providerMessageId`; out-of-order events never regress a terminal `delivered` (HTTP wiring comes in Phase 5/6)
- `packages/alerts/src/templates.ts` — subject/body builders for `incident_opened`, `incident_resolved`, `test` (plain-text + minimal HTML; Slack/Discord get block/embed formatting)
- `fixtures/webhook-sink/` — Express server: records every POST to memory + `GET /__requests`, `DELETE /__requests`
- `packages/db/src/delivery-log-store.ts` — Prisma implementation of `DeliveryLogStore` (lives in db package to keep `alerts` dependency-free)
- Contract test suite `packages/alerts/test/adapter-contract.ts` run against every adapter

**Key notes**: adapters take their config via constructor injection (API key, fetch impl) — no env reads inside the package. Resend/Twilio real adapters are written now but only exercised by contract tests through injected fake fetch; the mock adapter + webhook sink cover runtime behavior. Keep naming/shape decisions in a short `packages/alerts/README.md` noting the AlertProof parity contract.

**External deps/env**: none required. `RESEND_API_KEY`/Twilio vars documented but unused locally (`ALERT_TRANSPORT=mock`).

**Tests**: dispatcher fan-out writes one log row per route; concurrent dispatch of the same delivery sends once (`transition` claim — lost race is a no-op); retry-then-fail path; idempotent re-dispatch (same `messageKey`) sends nothing new; entitlement-blocked route → `skipped` row (never silently dropped); Slack/Discord adapters against webhook-sink assert payload shape; Resend/Twilio adapters against injected fake fetch assert request body/headers **and** `verifyStatusWebhook` reject/accept + `parseStatusEvent` mapping; status pipeline advances `queued→sending→sent→delivered/bounced` and out-of-order events don't regress `delivered`; `mock://` destination routes to the mock adapter under `ALERT_TRANSPORT=real`.

**Acceptance criteria**
- `pnpm test --filter alerts` green with no network access.
- A script `pnpm demo:alert` dispatches a fake incident to mock email + sink-Slack and prints the resulting delivery-log rows.

---

### Phase 2 — Checkout-test engine + local storefront fixture

**Goal**: real Playwright engine that runs the 4-step checkout walk-through (§1.5) against a local mock storefront, with full artifact capture, provably catching every failure mode.

**Files**
- `fixtures/storefront/src/server.ts` — Express app with routes + failure-mode switch (§1.5); templates in `fixtures/storefront/views/` deliberately using Shopify-ish DOM (add-to-cart form posting `/cart/add`, checkout page with email input + payment iframe from a second local origin/port to simulate a payment-provider iframe)
- `packages/engine/src/definition.ts` (`CheckoutTestDefinition`, `CheckRunResult`, `StepResult`, normalized `FailureCode` enum)
- `packages/engine/src/steps/` — `visit-product.ts`, `add-to-cart.ts`, `go-to-checkout.ts`, `assert-payment.ts` (each documents its selector strategy + fallbacks inline)
- `packages/engine/src/runner.ts` — browser lifecycle (shared Chromium, context per run), UA/etiquette headers, step loop, capture plumbing
- `packages/engine/src/capture.ts` — console collector, failed-request collector, script-origin collector, screenshot-on-failure
- `packages/engine/src/artifact-store.ts` — `ArtifactStore` port + `LocalArtifactStore`
- `packages/engine/src/compliance.ts` — robots.txt fetch/log, frequency-floor guard helper, control-probe helper (for `STORE_UNREACHABLE` vs engine-error classification), bot-challenge page detector
- `docs/COMPLIANCE.md` — first draft: identified UA, stop-before-payment **and never-enter-form-data** invariants, interval floors, allowlisting instructions for merchants, the merchant-consent authorization model (§1.5 — incl. the honest robots.txt position and stop-on-uninstall guarantee), bot-challenge policy (classify + surface, never bypass), synthetic-traffic side effects (analytics exclusion guidance, no-abandoned-checkout-email guarantee), note on Shopify automated-traffic policy (flagged as needing verification with live docs at launch — see §5)

**Key notes**: engine takes a `Browser` or launches its own — tests inject one launched instance for speed. All assertions are content/HTTP-level. The payment-iframe simulation must load from a *different origin* (second Express listener on :4601) so `PAYMENT_IFRAME_MISSING` detection is honest.

**External deps/env**: none — Playwright Chromium installs via `pnpm exec playwright install chromium` (document in root README; it downloads a browser binary, which is a normal dev dependency, not a credential).

**Tests** (`@engine` tag): mode `ok` → passed with 4 step timings + non-empty script-origin set; each failure mode → correct `failureCode` + failing step + screenshot file exists + console/network capture populated for the relevant modes; `slow_checkout` → `TIMEOUT_*`; `sold_out` → `PRODUCT_UNAVAILABLE`; `bot_challenge` → status `error` + code `BOT_CHALLENGE`; fixture listener stopped (control endpoint up) → status `failed` + `STORE_UNREACHABLE`; control endpoint also down → status `error` (our network, not theirs); observation modes `console_error` / `third_party_script_added` still **pass** (captured as data, not failures); runner never navigates past the payment step and never submits any form data (assert no request to fixture's `/checkout/complete` endpoint and no POST carrying field values from the checkout page — the fixture exposes both signals precisely to prove non-submission).

**Acceptance criteria**
- `pnpm test:engine` green locally, headless, no creds.
- `pnpm demo:check -- --mode payment_iframe_missing` runs one check against the fixture and prints the `CheckRunResult` JSON + artifact paths.

---

### Phase 3 — Job queue, scheduler, worker process

**Goal**: monitors run on schedule end-to-end: scheduler tick → `run-check` job → engine → `CheckRun` persisted. Works identically on memory and BullMQ drivers.

**Files**
- `packages/queue/src/types.ts` (`JobQueue`, `JobHandler`, `EnqueueOpts` with `delayMs`, `attempts`, `backoff`)
- `packages/queue/src/memory-driver.ts`, `packages/queue/src/bullmq-driver.ts`, `packages/queue/src/index.ts` (driver factory from core config)
- `packages/queue/test/queue-contract.ts` — shared contract suite (FIFO, delay, retry, backoff, concurrency cap)
- `apps/worker/src/main.ts` — boot: config → queue → register processors → start scheduler
- `apps/worker/src/scheduler.ts` — 30s tick, due-monitor query, entitlement clamp, `nextRunAt` advance, enqueue `run-check`
- `apps/worker/src/jobs/run-check.ts` — load monitor → build `CheckoutTestDefinition` (storefrontUrl from Shop) → `CheckoutRunner` → persist `CheckRun` (+ artifacts) → update `Monitor.lastRunAt/lastStatus/consecutiveFails` → **hand off to incident logic (stub until Phase 5: just records)**
- `apps/worker/src/jobs/index.ts` job registry (recheck/dispatch-alert/poll-store-changes registered as stubs)
- `packages/db` additions: monitor/run repository functions used by jobs (thin, testable)

**Key notes**: scheduler implements the §1.3 concurrency rules — atomic per-monitor claim (conditional `updateMany` on `nextRunAt`, affected-rows = 1, *before* enqueue; crash between claim and enqueue skips one interval, which is acceptable), BullMQ `jobId` dedupe, and the `Monitor.runningAt` in-flight guard in the `run-check`/`recheck` handlers (stale after 5 min; cleared in `finally`). A `run-check` job re-verifies the monitor is still enabled. Handlers are idempotent (at-least-once delivery). Concurrency: queue-level concurrency = `ENGINE_CONCURRENCY`. BullMQ driver is written and contract-tested only if a local Redis is available — the contract suite auto-skips the BullMQ half when `REDIS_URL` is unset (CI note in README), memory driver is the always-on truth.

**External deps/env**: Redis optional (`QUEUE_DRIVER=memory` default).

**Tests**: contract suite on memory driver (and BullMQ when Redis present), including the duplicate-delivery case (same job delivered twice → handler effect happens once); scheduler unit tests with fake clock (due selection, interval clamping by plan, no double-enqueue, **two concurrent ticks claim each due monitor exactly once**); in-flight guard test (second `run-check` for a monitor with `runningAt` set → `skipped` run, no engine invocation; stale lock is reclaimed); `run-check` integration with fixture storefront (`@e2e`-lite): seed monitor → run scheduler tick manually → assert `CheckRun` row with timings + status.

**Acceptance criteria**
- `pnpm worker` + `pnpm fixture` running together: seeded monitor (interval 1 min for demo) produces new passing `CheckRun` rows on schedule against the fixture; flipping the fixture mode produces failing rows with artifacts.

---

### Phase 4 — Failure pipeline: artifacts, AI diagnosis, app-stack change log

**Goal**: failures become *intelligence*: normalized failure context, deterministic heuristic diagnosis, optional LLM diagnosis behind the adapter, and the "what changed right before" change log.

**Files**
- `packages/diagnosis/src/types.ts` — `FailureContext` (failure code/step/message, console errors, failed requests, script-origin diff vs last passing run, recent `StoreChangeEvent`s, step timings, recent run history summary), `Diagnosis` (`summary`, `probableCause`, `evidence[]`, `confidence: 'low'|'medium'|'high'`, `provider`, `model?`), `Diagnoser` interface
- `packages/diagnosis/src/heuristic.ts` — deterministic rule table keyed on failure code + evidence (e.g. `PAYMENT_IFRAME_MISSING` + failed request to payment origin → "The payment provider's iframe failed to load…"; `ADD_TO_CART_NOT_FOUND` → product/theme change; `CHECKOUT_HTTP_5XX` → Shopify-side or app conflict; script-origin diff present → "…this began after script X appeared"). Every failure code maps to *some* plain-English output — no dead ends.
- `packages/diagnosis/src/anthropic.ts` — `@anthropic-ai/sdk`, model from `LLM_MODEL` (default `claude-opus-4-8`), structured `FailureContext` in the user turn, JSON-schema-constrained output (`output_config.format`), zod-validated; on API error/timeout/invalid output → log + delegate to heuristic. Client injected for testability.
- `packages/diagnosis/src/index.ts` — factory: provider from config; `anthropic` only when key present, else heuristic.
- `apps/worker/src/jobs/poll-store-changes.ts` — hourly per shop: `ShopifyAdmin.getMainTheme()` (mock returns fixture theme with a mutable `updatedAt`) → emit `theme_updated` events; plus per-run **script-origin diff**: compare `scriptOriginsJson` of latest run vs previous passing run → emit `script_added`/`script_removed` events (this runs inside `run-check` post-processing, works with zero Shopify API access)
- `packages/shopify/src/types.ts` + `mock.ts` (`MockShopifyAdmin`: fixture product list, theme info; enough surface for this phase — real impl in Phase 6)
- `apps/worker/src/failure-context.ts` — builds `FailureContext` from a failed `CheckRun` + DB history

**Key notes**: diagnosis is invoked when an incident *opens* (Phase 5 wires it) — but this phase ships `diagnoseRun(runId): Diagnosis` as a callable service and a CLI (`pnpm demo:diagnose <runId>`). AI diagnosis is a plan entitlement (growth+) — factory takes an `allowLlm` flag. The Anthropic adapter is fully written and unit-tested against an injected fake client; it is exercised for real only when a key is dropped in.

**External deps/env**: `ANTHROPIC_API_KEY` optional (mock/heuristic default). No Shopify creds (mock admin).

**Tests**: heuristic table — one test per failure code asserting deterministic wording + confidence; script-diff unit tests (added/removed/unchanged); `FailureContext` builder from seeded runs; Anthropic adapter with fake client (request shape: model id, JSON output format; response parsing; invalid-JSON → heuristic fallback; API error → fallback); change-event emission on theme `updatedAt` bump.

**Acceptance criteria**
- With fixture mode `third_party_script_added` then `payment_iframe_missing`: `pnpm demo:diagnose` on the failed run prints a diagnosis that cites the newly-appeared script origin — the PLAN.md wow-demo, fully offline.

---

### Phase 5 — Incidents, debounce, alert wiring

**Goal**: the false-positive-killing state machine (2 consecutive failures before alert), incident lifecycle, and alert dispatch through `packages/alerts`. After this phase the product's core loop is complete headless.

**Files**
- `apps/worker/src/incident-machine.ts` — pure state machine: `(monitorState, runResult) → actions[]` where actions ∈ `scheduleRecheck(delay)`, `openIncident`, `reopenIncident`, `resolveIncident`, `flagMonitorAttention`, `opsFlag`, `none`. Rules over the full §1.5 taxonomy:
  - `failed` #1 → recheck in `RECHECK_DELAY_SECONDS` (default 90); recheck `failed` (consecutiveFails ≥ 2) → open incident — with the confirming run's `failureCode` — **unless** an incident for this monitor resolved less than `REOPEN_COOLDOWN_MINUTES` (default 30) ago, in which case **reopen** that incident (clear `resolvedAt`, increment `reopenCount`) *without* re-sending the `incident_opened` alert (flap suppression; unchanged `messageKey` makes this natural).
  - `passed` with open incident → resolve; `passed` otherwise → reset `consecutiveFails` and `consecutiveErrors`.
  - `error` → **no incident, no alert, and no counter reset** (no-signal: it neither confirms nor clears a failure streak); increments `consecutiveErrors`, and ≥ 3 consecutive errors emits an internal ops flag (log/metric), never a merchant alert.
  - `PRODUCT_UNAVAILABLE` (after the same 2-consecutive debounce) → `flagMonitorAttention`: a "monitor needs attention — product unavailable" email-only notification (no SMS/page), and auto-disable the monitor after `PRODUCT_UNAVAILABLE_AUTOPAUSE` consecutive occurrences (default 6) with an in-app banner. Never opens a checkout incident.
  - Manual "run now" results feed the same machine.
- `apps/worker/src/jobs/recheck.ts` — same as run-check with `triggeredBy='recheck'`
- `apps/worker/src/incident-service.ts` — openIncident (in one transaction: create row + set `Monitor.openIncidentId` — the schema `@unique` makes duplicate opens impossible): snapshot `changeContextJson` (StoreChangeEvents in lookback window, default 24h), attach the **heuristic** diagnosis synchronously (deterministic, <1ms), and enqueue `dispatch-alert` per enabled channel route **immediately** — alert latency is never coupled to LLM latency. LLM diagnosis (entitlement-aware) runs as a separate `diagnose-incident` job with a hard timeout (10s, then keep heuristic) that *updates* `diagnosisJson`; the dashboard and the resolution email carry the richer text. resolveIncident: close row (clear `openIncidentId`) + resolution alerts
- `apps/worker/src/jobs/dispatch-alert.ts` — builds `AlertMessage` from incident + templates, calls `AlertDispatcher` with the shop's routes
- `packages/db` repo functions: incident CRUD, channel-route lookup, change-event window query
- Wire `run-check`/`recheck` post-processing to the machine (replacing Phase 3 stub)

**Key notes**: idempotency everywhere — `messageKey = incident:{id}:{opened|resolved}` means retried jobs can't double-alert; opening is guarded at the schema level by `Monitor.openIncidentId @unique` set in the same transaction (§2). Recheck happens *soon* (90s), not at the next interval — that's the "re-check before alerting" promise. Free plan: heuristic diagnosis only, email only (non-entitled routes logged as `skipped`, per §1.4).

**External deps/env**: none (mock transports, memory queue, SQLite).

**Tests**: state machine table-driven tests (all transitions incl. flapping fail-pass-fail-fail → reopen within cooldown, no second `incident_opened` delivery; error runs → no incident + no counter reset + ops flag at 3; `PRODUCT_UNAVAILABLE` → attention notification + auto-pause, never an incident; error interleaved in a fail streak doesn't break the streak); alert-before-diagnosis ordering (dispatch-alert enqueued before the LLM job resolves; hanging fake LLM client never delays the delivery row); full pipeline E2E (`@e2e`, per §1.7): fixture ok → break → within two scheduler ticks + recheck an incident exists with diagnosis + `AlertDelivery` rows (`incident_opened` on email-mock + sink-Slack) → fix fixture → resolved + resolution deliveries; duplicate-job injection double-fires `dispatch-alert` → exactly one delivery row per route.

**Acceptance criteria**
- `pnpm test:e2e` green, no creds.
- `pnpm demo:incident` script runs the whole loop compressed (seconds-scale intervals) and prints: runs → recheck → incident + diagnosis text → delivery log — the investor/merchant demo in one command.

---

### Phase 6 — Embedded app UI (React Router 7 + Polaris)

**Goal**: the merchant-facing app: no-code monitor setup (product picker), status dashboard, incident detail with artifacts + diagnosis, alert-channel settings with "test my alerts". Fully navigable at `localhost:3000` with `SHOPIFY_AUTH=mock`.

**Files**
- `apps/web/` scaffolded following the current Shopify React Router template shape (`@shopify/shopify-app-react-router`, `@shopify/polaris`, `vite`), sharing the workspace Prisma client + session table
- `apps/web/app/shopify.server.ts` — real template config, **wrapped** by `apps/web/app/auth.server.ts`: `requireShop(request)` returns `{shop, admin: ShopifyAdmin, billing: BillingAdapter}` — real path uses template auth + GraphQL impls; `SHOPIFY_AUTH=mock` returns dev shop + `MockShopifyAdmin`/`MockBilling`. All routes call only the wrapper.
- `packages/shopify/src/real.ts` — GraphQL Admin implementations (`listProducts` via products query, `getMainTheme` via themes query) written against the documented API, exercised in dev only through the mock twin
- Routes (all Polaris):
  - `app._index.tsx` — dashboard: monitor cards (last status, uptime % over 7/30d, response-time sparkline from step timings, open-incident banner), empty state → setup wizard
  - `app.monitors.new.tsx` — wizard: product dropdown (`admin.listProducts`), interval select (entitlement-clamped, upgrade hints), creates Monitor + enqueues immediate `run-check`, shows live first-run result
  - `app.monitors.$id.tsx` — run history table, uptime/latency charts (lightweight SVG, no chart lib dependency), enable/disable, run-now action
  - `app.incidents.$id.tsx` — the money page: diagnosis summary card, screenshot (served via `apps/web/app/routes/artifacts.$runId.$file.ts` streaming from `ArtifactStore`), console errors, failed requests, "what changed right before" (change events), timeline
  - `app.settings.alerts.tsx` — channel CRUD (email/slack/discord/sms per entitlement), **"Test my alerts"** button → dispatches `event:'test'` through the real dispatcher and then renders the fresh delivery-log rows with statuses (AlertProof's proof-on-day-one moment)
  - `app.settings.tsx` — storefront URL override (dev: fixture URL), plan display
  - `webhooks.*.tsx` — Shopify webhooks: `app/uninstalled` → **immediately disable all monitors, cancel pending jobs, set `Shop.uninstalledAt`, purge the encrypted access token** (synthetic traffic must stop the moment consent is withdrawn — COMPLIANCE.md guarantee); plus the **mandatory GDPR compliance topics** `customers/data_request`, `customers/redact`, `shop/redact` (required for app review; we store no customer PII — data_request returns a stored-data summary, shop/redact purges shop rows past the retention window); plus `webhooks.resend.tsx` / `webhooks.twilio.tsx` → `packages/alerts/status-webhooks` (adapter `verifyStatusWebhook` enforced at the route, not deferred)
- `apps/web/app/services/` — thin loaders-to-repo glue; uptime/latency aggregation queries (**uptime % counts `passed`/`failed` runs only — `error` and `skipped` runs are excluded so our own outages never dent a merchant's uptime stat**)

**Key notes**: `INLINE_WORKER=1` in dev boots the memory-queue processors inside the web process so the wizard's "run first test now" works with a single `pnpm dev` (plus the fixture). Polaris renders fine outside the Shopify iframe in mock mode (App Bridge wrapped so it no-ops when unauthenticated-embed). Keep all business logic in packages/worker services — routes stay thin.

**External deps/env**: Shopify creds **not** needed (`SHOPIFY_AUTH=mock`). Live-embed verification against a dev store is a later manual step documented in `DEPLOYMENT.md`.

**Tests**: loader/action tests with mock auth (monitor create respects entitlements; test-alert action writes delivery rows); `app/uninstalled` handler test (monitors disabled, token purged, scheduler no longer selects them); compliance-webhook handlers respond correctly to mock-signed payloads; uptime aggregation unit tests (incl. error-run exclusion); Playwright web smoke (`@web`): boot web (mock auth, inline worker, fixture) → create monitor via UI → see passing run on dashboard → break fixture → incident appears → incident page shows screenshot + diagnosis.

**Acceptance criteria**
- `pnpm dev` (web + fixture, single command via root script) → full merchant journey clickable end-to-end in a plain browser, no Shopify account.

---

### Phase 7 — Billing + plan gating

**Goal**: Shopify Billing behind `BillingAdapter`; plan upgrades/downgrades change entitlements everywhere they're enforced.

**Files**
- `packages/shopify/src/billing-real.ts` — `appSubscriptionCreate` mutation + confirmation-URL redirect flow + `APP_SUBSCRIPTIONS_UPDATE` webhook handling, per current Billing API docs; 14-day trial constant
- `packages/shopify/src/billing-mock.ts` — `ensureSubscription(plan)` instantly activates (writes `BillingSubscription` + `Shop.plan`); a dev-only route/action to switch plans freely
- `apps/web/app/routes/app.billing.tsx` — plan comparison page (Polaris), upgrade/downgrade CTAs; in mock mode buttons switch instantly, in real mode redirect to Shopify confirmation
- `apps/web/app/routes/webhooks.app_subscriptions_update.tsx`
- Enforcement sweep (most already built in Phases 3–6, verified here): monitor count at create, interval clamp in scheduler *and* wizard, channel types at config + dispatch, AI diagnosis flag, status-page flag; downgrade reconciliation job (`apps/worker/src/jobs/reconcile-plan.ts`): over-quota monitors disabled (newest first), intervals re-clamped, non-entitled channels disabled — with an in-app banner explaining what was paused
- `packages/core/plans.ts` finalized with prices/trial metadata

**External deps/env**: Shopify Partner creds required only for the real charge flow; everything verifiable via `MockBilling`.

**Tests**: mock-billing plan switch drives entitlements (create 2nd monitor on free → blocked; upgrade → allowed); downgrade reconciliation (pro→free with 5 monitors → 1 enabled, others disabled + banner data); real-billing module unit tests with faked GraphQL responses (mutation shape, webhook → subscription status transitions).

**Acceptance criteria**
- With mock billing: switching plans in the UI immediately changes wizard limits, scheduler clamps, channel availability, and diagnosis provider — demonstrated by the web smoke test extended to cover an upgrade.

---

### Phase 8 — Public status page

**Goal**: Pro-tier public status page (`/status/:slug`) — uptime %, incident history, response-time trend — server-rendered, unauthenticated, cache-friendly. Also the seed of the marketing "Shopify status — actually tested" page.

**Files**
- `apps/web/app/routes/status.$slug.tsx` — public route (no Polaris/App Bridge; small self-contained CSS): overall state banner (operational / incident), 90-day uptime bar per monitor (day buckets), recent incidents list (opened/resolved, duration, *sanitized* summary — no screenshots/console on public page), response-time trend SVG
- `apps/web/app/services/status-page.server.ts` — aggregation queries + 60s in-memory cache
- `app.settings.status-page.tsx` — enable/disable, slug editor (uniqueness), title; entitlement-gated (Pro), with upgrade CTA otherwise
- Sanitization helper: public incident text = failure-code-based generic phrasing, never raw diagnosis/evidence (may contain store internals)
- robots/meta: public page indexable; `noindex` when disabled

**External deps/env**: none.

**Tests**: aggregation unit tests (uptime math incl. partial days, no-data days); route tests: disabled/unknown slug → 404, enabled → renders; sanitization (diagnosis internals never in HTML); entitlement gate.

**Acceptance criteria**
- Seeded pro shop with mixed run history → `http://localhost:3000/status/dev-shop` renders uptime bars + incident history in a logged-out browser; free shop slug 404s.

---

### Phase 9 — Hardening, E2E, docs, demo polish

**Goal**: production-quality pass: reliability edges, observability, docs that make credential drop-in mechanical, and a compelling one-command demo.

**Files / work items**
- Reliability: global job error handler + dead-letter records (`failedJson` table or log); engine watchdog (kill runs exceeding a hard wall-clock cap, mark `error` per the §1.5 taxonomy — the failed/error/`STORE_UNREACHABLE` classification itself is built in Phases 2 and 5; this phase hardens and end-to-end-verifies it); scheduler catch-up guard after downtime (cap backlog, skip stale runs); graceful shutdown (drain jobs, clear `runningAt` locks, close browser)
- Data hygiene: retention job (prune CheckRuns + artifacts by plan retention; keep incident-linked artifacts), artifact orphan sweep
- Security pass: encrypted token storage verified, webhook HMAC verification (Shopify + Resend + Twilio signatures — mock-verified in tests), rate limiting on public status page, no secrets in logs (pino redaction)
- Observability: per-job structured logs with runId/monitorId correlation; simple `/healthz` (web + worker); counters logged per tick (runs, failures, alerts)
- Docs: finalize `docs/COMPLIANCE.md` (incl. the open verification items from §5), write `docs/DEPLOYMENT.md` — exact credential drop-in checklist: Shopify Partner app + scopes + app URL, Postgres provider flip + migration regen (§1.6 note), Redis, Resend domain + webhook secret, Twilio, `ANTHROPIC_API_KEY`, S3 artifact store TODO; `docs/ARCHITECTURE.md`; root `README.md` (quickstart: 3 commands to demo)
- Demo: `pnpm demo` — boots fixture + web (mock auth, inline worker), seeds a shop with history, opens instructions for the break-the-store walkthrough
- Full test sweep: raise coverage on state machine/dispatcher/entitlements; ensure `pnpm test && pnpm test:engine && pnpm test:e2e` green from clean clone; Windows path-safety check (no POSIX-only path handling — artifacts, SQLite URL)

**External deps/env**: none.

**Acceptance criteria**
- Clean clone → `pnpm install && pnpm exec playwright install chromium && pnpm db:migrate && pnpm db:seed && pnpm test && pnpm test:engine && pnpm test:e2e` all green with zero creds on Windows.
- Engine-crash injection (killed browser / runner exception / control probe failing too) produces `error` runs and **no** incident/alert; store-down injection (fixture listener stopped, control endpoint up) produces `STORE_UNREACHABLE` failures and, after the debounce, a **real incident + alert** — the monitor must page on a hard-down store.
- `docs/DEPLOYMENT.md` enumerates every §3 prod-blocking var with the exact place it's consumed.

---

## 5. Open Questions / Risks

1. **Shopify bot-detection on live checkouts** — the single biggest product risk (PLAN.md flags it). The fixture proves the engine, not challenge-free operation against real `/checkouts/…`. The engine now *classifies* challenges (`BOT_CHALLENGE` → error-class, surfaced with allowlisting instructions, never bypassed — §1.5), but classification isn't a mitigation for the business risk: **validate against a real dev store the moment Partner creds exist** — budget a spike; if checkout hard-blocks automation, fallback wedge is cart+checkout-reachability assertions (weaker but still ahead of status-only competitors).
2. **Checkout DOM drift** — selectors for the payment-step assertion are Shopify-controlled (Checkout Extensibility rollout changes markup). Mitigated by assertion-level checks + normalized failure codes + (post-MVP) canary suite on own dev stores; the fixture should be updated to mirror real checkout markup once observed live.
3. **Automated storefront traffic ToS** — the plan now commits to a merchant-consent authorization model (install = consent; stop-on-uninstall; identified UA; honest robots.txt position — §1.5 / Phase 2 COMPLIANCE.md), but the README Phase-0 spike ("Shopify's rules on automated storefront traffic") still needs a live docs/policy check before public launch. If policy is hostile even to consented monitoring, the app pivots to requiring explicit merchant opt-in via a theme snippet/allowlist token.
4. **Prisma SQLite→Postgres flip** — mechanical but must be actually executed once (migration regen, `String`-JSON columns stay as `TEXT`). Optionally later: move JSON columns to native `jsonb` in a Postgres-only migration.
5. **Real Shopify template drift** — Phase 6 pins `@shopify/shopify-app-react-router`; template details (session storage adapter names, webhook registration API) should be re-verified against the live template when scaffolding, not assumed from this plan.
6. **BullMQ driver realism** — memory driver is the tested truth locally; BullMQ contract tests auto-skip without Redis. Before prod, run the contract suite against a real Redis (one env var, zero code).
7. **App-stack change detection limits** — there is no public Admin API for "list installed apps"; our proxy signals are theme `updated_at` + storefront script-origin diffs. Good enough for "what changed right before" annotations; set expectations in UI copy ("detected script/theme changes"), not "app X was installed".
8. **SMS costs/compliance** (Pro) — Twilio sender registration (A2P 10DLC) is a launch-ops task, not code; keep SMS behind Pro and BYO-consideration open (AlertProof PLAN uses BYO-Twilio framing).
9. **Uptime (competitor) pricing re-check** — README asks to re-verify the $99 wedge claim at build time; marketing copy in the UI/status page should avoid hardcoding competitor claims.
10. **Cross-repo reuse mechanics** — `packages/alerts` is designed portable; decide later whether it graduates to a shared private package consumed by both repos or stays copy-synced (README of the package documents the parity contract either way). Note: AlertProof's own implementation plan predates the §1.4 portability contract — when its delivery phase is built, it should adopt these interface names, with its Postgres SKIP-LOCKED claim implementing the `DeliveryLogStore` port.

---

## Review revisions

Revised 2026-07-20 per `PLAN_REVIEW.md` (adversarial senior-engineer review). BLOCKER and MAJOR findings folded in: (B1) §1.4 rewritten as an AlertProof-compatible portability contract — 8-state delivery vocabulary, adapter-owned status-webhook verify/parse, claimable `DeliveryLogStore` port, `mock://` convention; (B2) three-way run taxonomy (`passed|failed|error`) with control-probe classification of `STORE_UNREACHABLE` defined in Phase 2 and consumed by the Phase 5 machine — store-down now correctly alerts, engine errors never do, uptime excludes error runs, Phase 9 acceptance corrected; (B3) scheduler atomic claim + per-monitor `runningAt` in-flight guard + at-least-once contract test; (M1) alert dispatch decoupled from LLM diagnosis (heuristic sync, LLM async with 10s cap); (M2) `PRODUCT_UNAVAILABLE` routed to a "monitor needs attention" notification, never a checkout incident; (M3) consent-based authorization model + `BOT_CHALLENGE` never-bypass policy in COMPLIANCE.md; (M4) `app/uninstalled` teardown + mandatory GDPR webhooks in Phase 6; (M5) never-enter-form-data invariant + analytics-pollution docs; (M6) schema: `Monitor.openIncidentId @unique`, `runningAt`, `consecutiveErrors`, `providerMessageId`/FK indexes; (M7) flap suppression via reopen-within-cooldown. MINOR findings remain in `PLAN_REVIEW.md` only.
