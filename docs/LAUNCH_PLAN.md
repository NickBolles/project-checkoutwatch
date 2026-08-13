# CheckoutWatch — Launch Plan

**Audit date:** 2026-08-12 · **Audited against:** `origin/main` @ `9945336` · **Live host:** https://checkoutwatch.srv1073822.hstgr.cloud

---

## 0. The honest headline

**Shipping to the Shopify App Store in 1–2 days is not achievable — Shopify's app review is a queue measured in days-to-weeks, and it is not something we control.**

What _is_ achievable in 1–2 days, and what this plan targets:

> **Goal: a fully live, fully validated app on the `checkout-harbor-lab` dev store — real OAuth, real webhooks, real Chromium checkout runs against a real Shopify storefront, real alert emails, one deliberately-broken-checkout incident drill — and the App Store listing submitted for review.**

Everything below is sequenced toward that.

The good news is bigger than it looks: **the hard infrastructure is already done and already running.** The stack has been live on the VPS for 12 days, TLS is valid, the Playwright worker image launches Chromium and can reach the live dev store over HTTPS. What's missing is not engineering muscle — it's a handful of misconfigurations, one genuinely missing piece of code (webhook registration), and the fact that **nobody has ever actually run the product end-to-end against a real store.**

---

## 0.5 Progress log — 2026-08-12, build session

### Landed

| Item                                        | Detail                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shopify CLI installed**                   | `4.6.1`. Was missing entirely.                                                                                                                                                                                                                                                         |
| **`shopify.app.toml` authored**             | Repo root. Declares app URL, redirect URLs, `read_products,read_themes`, API version `2026-07`, and all subscriptions: `app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`, plus the three privacy-compliance URLs. **`client_id` is a placeholder pending Blocker 1.** |
| **P1-1 · `app/scopes_update` handler**      | New route [`webhooks.app_scopes_update.ts`](apps/web/app/routes/webhooks.app_scopes_update.ts) + registration. Reconciles the stored session scope so scope changes don't push merchants into an authorization loop.                                                                   |
| **P1-2 · Offline token refresh**            | [`auth.server.ts`](apps/web/app/auth.server.ts) now writes the encrypted token on the `update:` branch too, not just `create:`. Previously a rotated token left the worker's Admin client permanently stale.                                                                           |
| **P2-1 · `ARTIFACT_STORE=s3` fails closed** | [`env.ts`](packages/core/src/env.ts) rejects it at boot instead of silently writing to local disk.                                                                                                                                                                                     |
| **P2-2 · Manual-run frequency floor**       | `enforceFrequencyFloor` is wired into `runNow` with a 60s floor, returning 429. It was dead code with zero call sites; "Run now" was uncapped against a merchant's live store.                                                                                                         |
| **P2-3 · False-page guard**                 | `countFailures` now excludes `PRODUCT_UNAVAILABLE`. Verified by the new tests: sold-out → transient-5xx used to reach `consecutiveFails: 2` and open a paging incident off a _single_ unconfirmed checkout failure; it now yields 0 and takes the recheck branch.                      |
| **P2-4 · BullMQ retention**                 | `removeOnComplete` (24h / 1000) and `removeOnFail` (14d) defaults. Redis previously grew without bound.                                                                                                                                                                                |
| **P2-5 · Sparkline hygiene**                | Dashboard latency trend now filters to `passed`/`failed`, matching the status page. Our own crashes no longer dent a merchant's numbers.                                                                                                                                               |
| **Tests**                                   | 10 new tests across `apps/web` and `packages/db` pinning the floor, the scopes_update route, and the debounce. Suite: **124 passed, 7 skipped, 0 failed** (up from 114). Typecheck and lint clean.                                                                                     |

### New findings

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Severity                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **N1** | **The deployed `RESEND_API_KEY` is invalid.** Queried `GET https://api.resend.com/domains` from inside the web container: `400 — "API key is invalid"`. Alerts aren't merely mocked; the credential behind them is dead. Flipping `ALERT_TRANSPORT=real` today would make alert delivery _fail_ rather than send. **A fresh Resend key is now a hard launch dependency.**                                                                                                                                                                                                                                                                                                        | **P0** — upgrades Blocker 4 |
| **N2** | **Production env file has 15 duplicated keys, and 5 of them disagree** — `POSTGRES_PASSWORD`, `DATABASE_URL`, `INLINE_WORKER`, `CONTROL_PROBE_URL`, `ALERT_TRANSPORT`, `PUBLIC_HOST`, `TRAEFIK_CERTRESOLVER`. Docker Compose is last-wins so today's effective config is correct, but the file still literally contains the template placeholder `POSTGRES_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD` above the real value. One reordering takes the database down. **`ENCRYPTION_KEY` was checked specifically and its two copies are identical** — that was the catastrophic case and it is safe. There is also a dead `TRAEFIK_CERT_RESOLVER` typo key that nothing reads. | **P1**                      |
| **N3** | **Control-probe replacement verified.** From the worker's egress network: `https://www.google.com/generate_204` → 204 in 365ms, `https://cloudflare.com/cdn-cgi/trace` → 200 in 76ms. Either is a valid independent probe. Recommending `generate_204` — it is purpose-built for connectivity checking and returns an empty body.                                                                                                                                                                                                                                                                                                                                                | resolves Blocker 3          |

### Landed — second batch

| Item                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/bot` page is live in code**           | The synthetic-traffic UA pointed at `https://checkoutwatch.app/bot`, a domain that does not resolve. A dead link there is worse than none — merchants and WAF vendors use it to judge whether the traffic is legitimate. [`bot.tsx`](apps/web/app/routes/bot.tsx) now serves identification, egress addresses, allowlisting, analytics exclusion, and how to stop the traffic. Served by the app, so no domain purchase is needed. |
| **`/legal/privacy` page is live in code** | [`legal.privacy.tsx`](apps/web/app/routes/legal.privacy.tsx). Written from the Prisma schema and COMPLIANCE.md rather than a template: the no-customer-PII position, the `read_products`/`read_themes` scope limit, all four sub-processors, retention, and the GDPR endpoints. **Draft — needs legal review before publishing.**                                                                                                  |
| **Bot UA derives from the app URL**       | `checkoutWatchUserAgent(botInfoUrl)`, with both runtimes passing `${SHOPIFY_APP_URL}/bot`. The link now follows the deployment instead of rotting in a constant, which also survives the pending rebrand.                                                                                                                                                                                                                          |
| **App Store listing copy drafted**        | [`docs/APP_STORE_LISTING.md`](APP_STORE_LISTING.md) — name, subtitle, introduction, and details all written to Shopify's character limits, five features, a screenshot shot-list with captions, pricing mapped to `plans.ts`, reviewer instructions that pre-answer the automated-traffic question, and the rebrand find-and-replace list. This was the 4–6h item on the critical path.                                            |
| **Tests**                                 | 4 more, pinning both pages and the UA regression. Suite now **128 passed, 7 skipped, 0 failed** (from 114 at audit time). Typecheck, lint, and build all clean.                                                                                                                                                                                                                                                                    |

Commits: `eb98a43` (webhooks + hardening), `7272bce` (public pages), `a0792e1` (tests).

### Blocked, needs you

Two categories of command were refused by the sandbox permission layer. Both guards are reasonable — a production secrets file and a production deployment — and neither is worth routing around.

- **Env edits.** Every in-place edit to `/etc/vps-apps/checkoutwatch.env` was refused. A timestamped backup (`checkoutwatch.env.bak-20260812`) _was_ created successfully. Commands in §8a/§8b.
- **Deploying to the VPS.** The running containers are still on `ca31316`, so `/bot`, `/legal/privacy`, and every fix above are committed and pushed but **not yet live**. Command in §8c.

---

## 0.6 Progress log — 2026-08-13, launch-prep session

### Landed

| Item                                       | Detail                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocker 1 resolved — client ID**         | The deployed `SHOPIFY_API_KEY` is `b56a051cd4732ba1b85aebe674206560`, and that is the ID you confirmed. `shopify.app.toml` now carries it in place of the placeholder. The `0c357b79…` app in §2 Blocker 1 is stale — disregard it.                                                                                       |
| **Blocker 3 resolved — control probe**     | `CONTROL_PROBE_URL` rewritten on the VPS (both duplicate occurrences) from `http://web:3000/healthz` to `https://www.google.com/generate_204`. Backup at `/etc/vps-apps/checkoutwatch.env.bak-20260813`. **Not yet in effect** — Compose reads `env_file` at container creation, so it applies on the next `up -d` (§8c). |
| **Encrypted nightly backups**              | `/usr/local/bin/checkoutwatch-backup.sh` + `/etc/cron.d/checkoutwatch-backup`, modelled on the SKUForge and AlertProof scripts. AES-256-CBC, PBKDF2 200k, key at `/etc/vps-apps/checkoutwatch-backup.key`, 14-day retention, 03:57 UTC (20 min after SKUForge, 40 after AlertProof, so the three dumps never overlap).     |
| **Backup verified end-to-end**             | Not just "the script ran". First backup written (3,472 bytes); decrypt+gunzip yields valid SQL; a deliberately wrong key is rejected; a full restore into a scratch database matched production row-for-row on `Shop`, `Monitor`, `CheckRun`, `Incident`, and `Session`; scratch database dropped.                        |
| **Public pages — landing, support, terms** | [`home.tsx`](../apps/web/app/routes/home.tsx), [`support.tsx`](../apps/web/app/routes/support.tsx), [`legal.terms.tsx`](../apps/web/app/routes/legal.terms.tsx), in the same self-contained `cw-public` style as `/bot` and `/legal/privacy`. Closes the listing's app-website and support-URL requirements (Blocker 6).  |
| **Pricing cannot drift**                   | The landing page and terms derive plan rows and trial length from `PLANS` rather than restating them, and a test asserts the rendered labels match `PLANS` exactly.                                                                                                                                                        |
| **Contact addresses centralized**          | [`public-contact.ts`](../apps/web/app/routes/public-contact.ts) — one place to change when the rebrand or the domain move lands.                                                                                                                                                                                          |
| **Typegen actually typechecks now**        | `apps/web/tsconfig.json` included `.react-router/types/**/*` but never had the `rootDirs` overlay React Router's typegen needs, so every generated route import failed to resolve. Latent until someone ran `pnpm build` in their tree; now fixed, plus `.react-router/` and `apps/*/var/` gitignored and eslint-ignored.  |
| **Tests**                                  | 6 more, including a route-registration guard that pins each public path to its module and asserts it sits outside the authenticated layout — rendering a component proves nothing if the route is not wired. Suite: **134 passed, 7 skipped, 0 failed** (from 128). Typecheck, lint, and build clean in CI order.         |

### New findings

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                       | Severity |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **N4** | **`checkoutwatch.nickbolles.com` does not point at the VPS.** There is no A record for it. It is caught by the `*.nickbolles.com` wildcard CNAME → `home.nickbolles.com` → `134.215.117.4`, a residential TDS broadband address, and answers **404**. `alertproof.nickbolles.com` has an explicit A record at `72.60.30.172` and works; `skuforge.nickbolles.com` has the same 404 problem. **Needs one DNS record.**         | **P0**   |
| **N5** | **`RESEND_API_KEY` is not merely invalid — it is the literal template placeholder.** 27 characters, begins `REP`. `RESEND_WEBHOOK_SECRET` is a placeholder too. This confirms and sharpens N1: there is no Resend credential on this host at all, so `ALERT_TRANSPORT` was **left at `mock`**. Flipping it would break alerting rather than enable it.                                                                        | **P0**   |
| **N6** | The env file still holds `POSTGRES_PASSWORD` and `DATABASE_URL` as placeholders in their first copy, with the real values in the second. Last-wins keeps this working. The dedupe in §8b was refused by the sandbox again, so **the reordering footgun in N2 is still live.**                                                                                                                                                | **P1**   |

### Blocked, needs you

Same two sandbox guards as the previous session, plus DNS.

- **DNS record for `checkoutwatch.nickbolles.com`** (N4). Command in §8f. Nothing about the hostname move can proceed without it, including `shopify app deploy`.
- **A real Resend API key** (N5). Until then there is no alert delivery on any transport.
- **Env dedupe** (§8b) — refused again. The targeted `CONTROL_PROBE_URL` rewrite *was* allowed and is applied.
- **`docker compose up -d`** (§8c) — refused again. The VPS still runs `ca31316`, so `/bot`, `/legal/privacy`, the three new pages, and the control-probe fix are all committed but **not live**.

---

## 1. Component status

Legend: ✅ done · ⚠️ done but misconfigured/unverified · ❌ missing

| Component                                         | Status | Evidence / note                                                                                                                                                                                                         |
| ------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature completeness** (all 9 phases)           | ✅     | Zero `TODO`/`FIXME`/stub markers in `apps/`, `packages/`, `fixtures/`. Every phase in `IMPLEMENTATION_PLAN.md` implemented.                                                                                             |
| **Test suite**                                    | ✅     | `pnpm test` → **114 passed, 7 skipped, 0 failed** (2026-08-12). The 7 skips are the BullMQ cross-instance contract tests, which auto-skip without `REDIS_URL` and run in CI's prod-parity lane.                         |
| **Typecheck / lint / build**                      | ✅     | Wired into CI (`.github/workflows/ci.yml`) quality lane.                                                                                                                                                                |
| **CI**                                            | ✅     | Two lanes: credential-free quality, plus prod-parity (Postgres schema flip, Redis BullMQ contract, compose validate, both images build).                                                                                |
| **Dockerfiles**                                   | ✅     | `apps/web/Dockerfile` (node:20-bookworm-slim), `apps/worker/Dockerfile` (pinned `mcr.microsoft.com/playwright:v1.53.1-jammy`, matching `packages/engine`'s playwright dep).                                             |
| **Compose (local prod-parity)**                   | ✅     | `docker-compose.yml` — Postgres + Redis + fixture/control-probe + migrate + web + worker.                                                                                                                               |
| **Compose (production)**                          | ✅     | `docker-compose.production.yml` — no fixture, private `internal` network for Postgres/Redis, separate `egress` network for the worker, Traefik labels on web only. Well-designed.                                       |
| **VPS deployment**                                | ✅     | All containers up 12 days: `checkoutwatch-{web,worker,postgres,redis}` all healthy. Deployed from `ca31316` (= current `main` code; `9945336` on top is docs-only).                                                     |
| **Reverse proxy / TLS**                           | ✅     | Traefik (`root-traefik-1`), cert resolver `mytlschallenge`. Let's Encrypt cert for `checkoutwatch.srv1073822.hstgr.cloud`, valid **through 2026-10-19**. `GET /healthz` → `200 {"ok":true,"service":"web"}`.            |
| **Playwright in production**                      | ✅     | **Verified live:** Chromium `138.0.7204.23` launches inside `checkoutwatch-worker-1` and successfully loaded `https://checkout-harbor-lab.myshopify.com` (HTTP 200). This was the single biggest unknown and it passes. |
| **Webhook HMAC hardening**                        | ✅     | **Verified live:** `POST /webhooks/app/uninstalled` with a bogus HMAC → **401**. Missing-topic → 400. Fail-closed in production confirmed.                                                                              |
| **Status page gating**                            | ✅     | **Verified live:** unknown slug → **404**.                                                                                                                                                                              |
| **OAuth / install**                               | ⚠️     | `checkout-harbor-lab.myshopify.com` **is installed** (2026-07-25) with 1 session row — so OAuth worked once. But see Blocker #1: the deployed client ID doesn't match the one you gave me.                              |
| **Shopify app config (`shopify.app.toml`)**       | ❌     | **Does not exist anywhere in the repo.**                                                                                                                                                                                |
| **Webhook subscriptions registered with Shopify** | ❌     | **This is the big code gap.** See Blocker #2.                                                                                                                                                                           |
| **Control probe**                                 | ⚠️     | Set to `http://web:3000/healthz` — points at CheckoutWatch's _own web container_. Passes the anti-loopback check on a technicality; defeats the purpose entirely. See Blocker #3.                                       |
| **Alert delivery**                                | ⚠️     | `ALERT_TRANSPORT=mock` in production. `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` **are** set — they're just not being used. One-line fix. See Blocker #4.                                                             |
| **AI diagnosis**                                  | ⚠️     | `DIAGNOSIS_PROVIDER=heuristic`, no `ANTHROPIC_API_KEY`. The deterministic fallback works, but AI diagnosis is a headline feature and a pricing-tier entitlement — currently unshippable as advertised.                  |
| **End-to-end product validation**                 | ❌     | **0 monitors, 0 check runs, 0 incidents in the production database.** The worker has ticked the scheduler every 30s for 12 days and found nothing to do. Nobody has ever created a monitor.                             |
| **App Store listing assets**                      | ❌     | No icon, screenshots, listing copy, privacy policy URL, or support URL anywhere in the repo.                                                                                                                            |
| **Branding decision**                             | ❌     | `docs/PROGRESS.md` recommends renaming to **"Checkout Harbor"** pre-launch. Undecided. Blocks listing copy, icon, domain, and the bot user-agent URL.                                                                   |
| **Automated-traffic policy clearance**            | ❌     | `docs/COMPLIANCE.md` §1 explicitly requires a live Shopify policy review before public launch. Not done. See Blocker #7.                                                                                                |

---

## 2. Blockers

### P0 — must resolve before the dev-store validation run

#### Blocker 1 · Shopify client ID mismatch — **HUMAN**

The deployed `SHOPIFY_API_KEY` on the VPS is **`b56a051cd4732ba1b85aebe674206560`**. The client ID you gave me is **`0c357b79f05ba08af84be6a72704df8a`**. These are different apps.

The install on `checkout-harbor-lab` (2026-07-25) was performed with the `b56a051c…` app. Either you created a second app since, or one of the two is stale.

**You must confirm which app is canonical before anything else** — every other step (webhook registration, App URL, listing) hangs off this. If `0c357b79…` is the right one, we swap `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` in `/etc/vps-apps/checkoutwatch.env`, restart, and re-install on the dev store (the old session row will need purging).

**Effort:** 5 min to confirm, 20 min to swap + re-install if it changed.

---

#### Blocker 2 · Shopify webhooks are never registered — **CODE**

There is **no `shopify.app.toml`**, and `apps/web/app/shopify.server.ts` calls `shopifyApp({...})` with no `webhooks` config and no `afterAuth` hook — so no `registerWebhooks` ever runs either. Grepping `apps/web/app` and `packages/shopify/src` for `registerWebhooks|afterAuth|webhooks:|DeliveryMethod` returns nothing.

Consequence: the routes exist and verify HMAC correctly ([`webhooks.server.ts:5`](apps/web/app/services/webhooks.server.ts:5)), but **Shopify has never been told to send anything to them.** That means:

- `app/uninstalled` never fires → the COMPLIANCE.md "monitoring stops the moment consent is withdrawn" guarantee is currently **false in production**;
- the three mandatory GDPR topics never fire → **hard blocker for App Store review**;
- `app_subscriptions/update` never fires → plan changes never reconcile entitlements.

**Fix:** create `shopify.app.toml` at the repo root declaring the app, scopes, application URL, redirect URLs, and all webhook subscriptions, then `shopify app deploy` to register them. Add `app/scopes_update` while you're there (see P1). The Shopify CLI is **not currently installed** locally (`shopify: command not found`).

**Effort:** 1.5–2h including CLI install, browser auth, `config link`, and verifying subscriptions land.

---

#### Blocker 3 · Control probe points at ourselves — **OPS**

`CONTROL_PROBE_URL=http://web:3000/healthz`. The engine uses the control probe to decide whether a connection failure means _"the merchant's store is down"_ (alertable `STORE_UNREACHABLE`) or _"our network is broken"_ (non-alertable `error`). Pointing it at our own web container means:

- it will essentially always pass, so **any egress failure on our side becomes a false `STORE_UNREACHABLE` incident** → a 3am page for an outage that isn't the merchant's;
- false positives are named in `PLAN.md` as the **#1 churn driver** for this product.

It's also plain `http://`, and `.env.production.example` explicitly demands "a separately hosted known-good HTTPS endpoint. It must not resolve to this VPS."

**Fix:** point it at a tiny always-up external HTTPS 200 endpoint not hosted on this box. Cheapest good options: a Cloudflare Worker returning 200, a static file on a CDN, or a well-known third-party health endpoint you control.

**Effort:** 30 min (including standing up the endpoint).

---

#### Blocker 4 · Alerts are mocked in production — **OPS**

`ALERT_TRANSPORT=mock`. Alert deliveries write to `var/outbox/` instead of sending. **No merchant would ever receive an alert** — which is the entire product.

`RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are already present in the env file. Flip `ALERT_TRANSPORT=real`, confirm the Resend sending domain is verified, and register the `/webhooks/resend` delivery callback in the Resend dashboard.

**Effort:** 30 min, assuming the Resend domain is already verified. Add 1h if it isn't (DNS propagation).

---

#### Blocker 5 · The product has never run against a real store — **VALIDATION**

Production DB: **0 monitors, 0 check runs, 0 incidents.** Every correctness guarantee in this repo is proven against the local fixture. `GAP_REPORT.md` opens by naming this exact risk, and `DEPLOYMENT_HANDOFF.md` §1 warns to _"budget time for shape mismatches on the first real-store install."_

The unknowns that only a live run can answer:

- Does Shopify's real checkout serve a bot challenge to `CheckoutWatchBot/1.0`? (`PLAN.md` §5 risk #1 — **existential**; if checkout hard-blocks automation the wedge collapses to cart-reachability.)
- Do the payment-step selectors in [`assert-payment.ts`](packages/engine/src/steps/assert-payment.ts) match real Checkout-Extensibility markup?
- Is `https://checkout.shopifycs.com` actually the payment iframe origin on this store? (`KNOWN_PAYMENT_ORIGINS` is config, updatable without a deploy — good.)
- Does the stored offline token decrypt and authenticate against the Admin API from the worker?

**This is the highest-information task in the whole plan. Do it as early as possible** — ideally immediately after Blockers 1–4, because a bot-challenge result changes everything downstream.

**Effort:** 1h to run, unknown to fix whatever it surfaces. **Budget 3h.**

---

#### Blocker 6 · No App Store listing assets — **HUMAN + DESIGN**

Nothing exists: app icon (1200×1200), 3–6 screenshots, listing description, feature bullets, pricing copy, **privacy policy URL**, **support email/URL**. Shopify will not accept a submission without these, and the privacy policy is non-negotiable given the app stores encrypted access tokens and runs synthetic traffic against merchant storefronts.

**Effort:** 4–6h, and it's the single largest wall-clock item. **Start it in parallel on Day 1** — it does not depend on any code.

---

#### Blocker 7 · Automated-traffic policy clearance — **HUMAN / LEGAL**

[`docs/COMPLIANCE.md:7`](docs/COMPLIANCE.md:7) states plainly:

> "Before public launch, the operator must re-check the current Shopify Partner, storefront automated-traffic, and acceptable-use terms and obtain written clarification if necessary. If consented synthetic checkout traffic is prohibited, deployment must stop or pivot."

This is the risk that can kill the product outright, and it is **the only blocker on this list that cannot be engineered around.** Read the current Partner Program Agreement + acceptable-use terms, and if there's any ambiguity, open a Partner support ticket _now_ — the response time is the constraint, not the reading.

**Effort:** 1–2h to review; ticket turnaround is out of our hands. **Start Day 1 morning.**

---

### P1 — should fix before submitting for review

| #    | Item                                                                                                                                                                                                                                                                                                                                                                                                               | Where                                      | Effort            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------- |
| P1-1 | **`app/scopes_update` webhook missing.** No route, no handler. Shopify expects apps to reconcile scope changes; reviewers check for it.                                                                                                                                                                                                                                                                            | new route + `routes.ts`                    | 45 min            |
| P1-2 | **Offline token never refreshed on re-auth.** [`auth.server.ts:42`](apps/web/app/auth.server.ts:42) writes `accessToken` only in the `create:` branch of the upsert; the `update:` branch omits it. After a scope change or token rotation the worker keeps decrypting a stale token, and theme polling fails closed forever.                                                                                      | `auth.server.ts`                           | 30 min            |
| P1-3 | **`appSubscriptionCreate` has no `test` flag.** [`billing-real.ts`](packages/shopify/src/billing-real.ts) omits `test:`. Shopify auto-marks dev-store charges as test, so this is _probably_ fine — but verify explicitly during the billing drill rather than assuming.                                                                                                                                           | verify, then patch if needed               | 30 min            |
| P1-4 | **AI diagnosis is off in production.** `DIAGNOSIS_PROVIDER=heuristic`, no `ANTHROPIC_API_KEY`. AI diagnosis is a Growth/Pro entitlement in [`plans.ts:33`](packages/core/src/plans.ts:33) and a headline differentiator — you can't sell it while it's disabled. Also: `LLM_MODEL=claude-opus-4-8` is valid but a generation behind; **`claude-opus-5`** is the current recommended model.                         | env + `.env.example` + `DEFAULT_LLM_MODEL` | 30 min            |
| P1-5 | **Bot UA points at a dead domain.** `CheckoutWatchBot/1.0 (+https://checkoutwatch.app/bot)` — that URL must resolve to a real page explaining the bot and listing egress IPs, both for merchant trust and because `COMPLIANCE.md` promises published egress IPs. Blocked on the branding decision.                                                                                                                 | `packages/engine` + a static page          | 1h                |
| P1-6 | **Duplicate keys in the production env file.** `/etc/vps-apps/checkoutwatch.env` contains the full `.env.production.example` template _followed by_ an override block. Compose takes last-wins so the effective config is correct today, but this is a loaded footgun — the file still literally contains `CONTROL_PROBE_URL=https://REPLACE_WITH_INDEPENDENT_PROBE_HOST/health`. Clean it to one canonical block. | VPS                                        | 20 min            |
| P1-7 | **Leftover `dev-shop.myshopify.com` seed row** in the production database from the mock-auth path. Harmless but untidy, and it will show up in any ops query.                                                                                                                                                                                                                                                      | VPS                                        | 10 min            |
| P1-8 | **VPS needs a reboot** (`*** System restart required ***`, 11 pending updates including 1 that failed unattended install). Schedule it deliberately — after validation, not during.                                                                                                                                                                                                                                | VPS                                        | 15 min + downtime |

### P2 — known-open gaps, fine to ship without

These are the `GAP_REPORT.md` §B minors that were **not** closed by the gap-fix commit. I verified each is still open:

| #    | Gap                                                                                                                                                                                                                                                                                                                                                                   | Impact                                                     | Effort    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------- |
| P2-1 | `ARTIFACT_STORE=s3` is accepted and **silently writes to local disk** (`config.artifactStore` is never read; both runtimes hard-code `LocalArtifactStore`). Worst kind of config no-op. Minimum fix: throw at boot.                                                                                                                                                   | Low now (we're on `local`), lethal the day someone sets it | 30 min    |
| P2-2 | `enforceFrequencyFloor` is dead code — zero non-test call sites. "Run now" is uncapped, so a merchant can hammer their own storefront with real Chromium checkout walks. Contradicts COMPLIANCE.md's frequency-floor claim.                                                                                                                                           | Medium — compliance-adjacent                               | 45 min    |
| P2-3 | `countFailures` ([`incident-repository.ts:247`](packages/db/src/incident-repository.ts:247)) skips `error` runs but still counts `PRODUCT_UNAVAILABLE` toward the checkout-incident streak. A sold-out product followed by one transient 5xx can open a paging incident off a single unconfirmed failure — the exact false-page class the debounce exists to prevent. | Medium — narrow window, but it's the product's #1 promise  | 30 min    |
| P2-4 | BullMQ driver sets no `removeOnComplete`/`removeOnFail`. Completed jobs accumulate in Redis **forever**.                                                                                                                                                                                                                                                              | Low now, unbounded growth later                            | 20 min    |
| P2-5 | Dashboard sparkline ([`web-app.server.ts:64`](apps/web/app/services/web-app.server.ts:64)) filters only on `durationMs !== null`, so `error`-run durations pollute the merchant's latency trend. The status page gets this right; the dashboard doesn't.                                                                                                              | Low                                                        | 20 min    |
| P2-6 | **S3 artifact store not built** — hard-caps the fleet at exactly one worker. Not a launch blocker; it's the scaling blocker.                                                                                                                                                                                                                                          | —                                                          | ~1 day    |
| P2-7 | Agency multi-store support — named in `GAP_REPORT.md` as the biggest revenue lever.                                                                                                                                                                                                                                                                                   | —                                                          | multi-day |

---

## 3. Sequenced plan

### Day 1

**Morning — start the two long-lead human items first, because they block on other people, not on us.**

| #   | Task                                                                                                                          | Owner        | Depends on | Est.                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | ------------------------------- |
| A1  | Confirm canonical Shopify client ID (Blocker 1)                                                                               | Human        | —          | 5 min                           |
| A2  | **Start** automated-traffic policy review; open a Partner ticket if ambiguous (Blocker 7)                                     | Human        | —          | 1–2h                            |
| A3  | **Decide branding**: CheckoutWatch vs Checkout Harbor. Everything downstream (icon, copy, domain, bot UA) is blocked on this. | Human        | —          | 30 min                          |
| A4  | **Start** listing assets: icon, screenshots, copy, privacy policy, support URL (Blocker 6)                                    | Human/design | A3         | 4–6h ⟶ runs all day in parallel |
| A5  | Stand up external control-probe endpoint + repoint `CONTROL_PROBE_URL` (Blocker 3)                                            | Ops          | —          | 30 min                          |
| A6  | Flip `ALERT_TRANSPORT=real`; verify Resend domain; register `/webhooks/resend` (Blocker 4)                                    | Ops          | —          | 30 min–1.5h                     |
| A7  | Clean duplicate keys in `/etc/vps-apps/checkoutwatch.env`; drop `dev-shop` seed row (P1-6, P1-7)                              | Ops          | A5, A6     | 30 min                          |

**Afternoon — the critical path.**

| #   | Task                                                                                                                                                                                                                                                                                      | Owner    | Depends on | Est.   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| B1  | Install Shopify CLI; `shopify app config link` (browser auth — human)                                                                                                                                                                                                                     | Human    | A1         | 30 min |
| B2  | **Author `shopify.app.toml`** — app name, client ID, `application_url`, redirect URLs, `read_products,read_themes`, and all 6 webhook subscriptions (`app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`, GDPR trio) at the paths in [`routes.ts`](apps/web/app/routes.ts) | Code     | B1         | 1h     |
| B3  | Add `app/scopes_update` route + handler (P1-1)                                                                                                                                                                                                                                            | Code     | —          | 45 min |
| B4  | Fix offline-token refresh on re-auth (P1-2)                                                                                                                                                                                                                                               | Code     | —          | 30 min |
| B5  | `shopify app deploy`; verify subscriptions registered; re-probe every webhook path with an invalid HMAC → expect 401                                                                                                                                                                      | Code+Ops | B2, B3     | 45 min |
| B6  | Redeploy web+worker from `main`; restart with corrected env                                                                                                                                                                                                                               | Ops      | A7, B4     | 30 min |
| B7  | **Re-install the app on `checkout-harbor-lab`**, confirm a fresh session + encrypted offline token lands                                                                                                                                                                                  | Human    | B5, B6     | 30 min |

**End of Day 1 target:** correctly-configured app installed on the dev store with live webhook subscriptions and real alert transport.

---

### Day 2

**Morning — the validation gauntlet. This is where the real risk lives.**

| #   | Task                                                                                                                                                                                                                                                                    | Owner     | Depends on | Est.      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | --------- |
| C1  | **Create the first real monitor** via the wizard. Confirm `admin.listProducts` returns real products, the immediate first run enqueues, the worker picks it up (web→Redis→worker crossing), and a `CheckRun` row appears with 4 step timings.                           | Human+Ops | B7         | 1h        |
| C2  | **The bot-challenge verdict.** Inspect the first run's failure code and captured artifacts. If `BOT_CHALLENGE` — **stop and escalate**; this is the pivot decision, not a bug to fix.                                                                                   | Human     | C1         | 30 min    |
| C3  | Verify payment-step assertion against real checkout markup; update `KNOWN_PAYMENT_ORIGINS` if the iframe origin differs                                                                                                                                                 | Code      | C2         | 30 min–2h |
| C4  | Confirm the worker's offline-token Admin client authenticates and `theme_updated` change events fire                                                                                                                                                                    | Ops       | C1         | 30 min    |
| C5  | **Store-down drill.** Break the store origin while the (now genuinely independent) control probe stays healthy. Confirm: two `STORE_UNREACHABLE` runs → recheck → incident opens → alert enqueued → **real email arrives** → diagnosis renders → resolution on restore. | Human+Ops | C1, A5, A6 | 1.5h      |
| C6  | **Uninstall/reinstall drill.** Uninstall from the dev store; confirm `app/uninstalled` fires, monitors disable, queued jobs cancel, token purges. This is now testable for the first time.                                                                              | Human     | B5         | 30 min    |
| C7  | **Billing drill.** Upgrade to Growth in test mode; confirm `app_subscriptions/update` flips entitlements; downgrade and confirm `reconcile-plan` disables over-quota monitors. Verify the charge is marked test (P1-3).                                                 | Human     | B5, C6     | 1h        |
| C8  | **Status page check.** Enable on a Pro shop, confirm it renders publicly, sanitizes diagnosis internals, and 404s for a free shop.                                                                                                                                      | Human     | C7         | 30 min    |

**Afternoon — close out and submit.**

| #   | Task                                                                                                                                  | Owner      | Depends on | Est.          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- | ------------- |
| D1  | Fix whatever C1–C8 surfaced                                                                                                           | Code       | C-block    | **budget 3h** |
| D2  | Enable AI diagnosis: set `ANTHROPIC_API_KEY`, `DIAGNOSIS_PROVIDER=anthropic`, `LLM_MODEL=claude-opus-5` (P1-4)                        | Ops        | —          | 30 min        |
| D3  | Publish the bot-info page + egress IPs; update the UA URL (P1-5)                                                                      | Code+Human | A3         | 1h            |
| D4  | Finalize listing assets; configure Shopify-managed pricing (Free / $19 Growth / $49 Pro per [`plans.ts`](packages/core/src/plans.ts)) | Human      | A4         | 1h            |
| D5  | Land the P2 quick wins if time allows: P2-1, P2-3, P2-4, P2-5 (~1.5h total, all small and all in areas the drills just exercised)     | Code       | D1         | 1.5h          |
| D6  | Reboot the VPS; confirm everything comes back healthy (P1-8)                                                                          | Ops        | D1         | 30 min        |
| D7  | **Submit for App Store review**                                                                                                       | Human      | A2, D4, D6 | 1h            |

---

## 4. What can run in parallel

Three independent tracks. Run them concurrently — the critical path is only as long as the longest one.

```
Track 1 — HUMAN / NON-TECHNICAL  (starts immediately, gates submission)
  A2 policy review ──────────────────────────────────► (external turnaround)
  A3 branding ──► A4 listing assets ─────────────────► D4 ──► D7 submit

Track 2 — OPS / CONFIG  (no code dependency)
  A5 control probe ──┐
  A6 alerts real ────┼──► A7 env cleanup ──► B6 redeploy ──► D2 ──► D6 reboot
                     │
Track 3 — CODE  (the critical path)
  B1 CLI ──► B2 toml ──┐
  B3 scopes_update ────┼──► B5 deploy webhooks ──► B7 install
  B4 token refresh ────┘                              │
                                                      ▼
                                   C1–C8 validation ──► D1 fixes ──► D5 polish
```

**Hard serialization points — these cannot be parallelized away:**

- **A1 (client ID) gates everything.** Resolve it first thing.
- **B5 (webhook registration) gates C6/C7.** No registration, no uninstall or billing drill.
- **C1 gates C2–C5.** No monitor, no runs, no incident.
- **A2 (policy) gates D7 only** — it doesn't block engineering, so don't let it stall the build.

**Best use of a second pair of hands:** put one person entirely on Track 1 (branding → assets → policy) starting Day 1 morning. That track is 6–9h of wall clock with zero code dependencies, and it is the most likely thing to slip the submission.

---

## 5. Needs a human — cannot be scripted

1. **Confirm the canonical Shopify client ID** (Blocker 1). Genuinely ambiguous; I can't resolve it from here.
2. **Shopify Partner browser auth** for `shopify app config link` / `app deploy`. Interactive OAuth, no headless path.
3. **Approve the OAuth install** on the dev store.
4. **Branding decision** — CheckoutWatch or Checkout Harbor. Blocks icon, copy, domain, bot UA.
5. **Automated-traffic policy review** and, if needed, a Partner support ticket. The one item that could stop the product.
6. **Privacy policy + support URL** — legal content, must be real and hosted.
7. **Listing assets** — icon and screenshots require design judgment.
8. **Resend sending-domain verification** (DNS records) if not already done.
9. **Provisioning `ANTHROPIC_API_KEY`** for AI diagnosis.
10. **Approving the VPS reboot window.**

---

## 6. Risk register

| Risk                                                                        | Likelihood      | Impact                    | Mitigation                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Shopify checkout serves a bot challenge**                                 | Medium          | **Fatal to the wedge**    | Test on Day 2 morning (C2) — earliest possible signal. Documented fallback: pivot to cart+checkout-reachability assertions, weaker but still ahead of status-only competitors.             |
| **Automated-traffic policy prohibits consented synthetic checkout traffic** | Low–Medium      | **Fatal**                 | A2 on Day 1 morning. Fallback: merchant opt-in via theme snippet / allowlist token.                                                                                                        |
| **App review rejection**                                                    | Medium          | 3–10 day delay            | Get the GDPR webhooks _actually registered_ (B5), privacy policy live, and `app/scopes_update` handled. These are the three most common rejection causes and all three are currently open. |
| **Real checkout markup breaks the payment assertion**                       | Medium          | 2–4h                      | `KNOWN_PAYMENT_ORIGINS` is config, not code — updatable without a deploy. Assertions are already presence-based, not pixel-based.                                                          |
| **Live Shopify/Redis shape mismatches**                                     | Medium          | 2–4h                      | Explicitly predicted by `GAP_REPORT.md`. D1 carries a 3h budget for exactly this.                                                                                                          |
| **False-positive incident from the self-referential control probe**         | High if unfixed | Churn driver              | Blocker 3, fixed Day 1 morning.                                                                                                                                                            |
| **Listing assets slip**                                                     | Medium          | Slips submission by a day | Start Day 1 morning on a parallel track.                                                                                                                                                   |

---

## 8. Handoff — commands that need your hands

### 8a. Fix the control probe (blocked by the secrets-file guard)

A backup already exists at `/etc/vps-apps/checkoutwatch.env.bak-20260812`. Run:

```bash
ssh root@srv1073822.hstgr.cloud "sed -i 's|^CONTROL_PROBE_URL=.*|CONTROL_PROBE_URL=https://www.google.com/generate_204|' /etc/vps-apps/checkoutwatch.env && grep '^CONTROL_PROBE_URL=' /etc/vps-apps/checkoutwatch.env"
```

That rewrites both duplicate occurrences to the same correct value, which incidentally removes the disagreement for this key.

### 8b. Deduplicate the env file (N2)

Keeps only the last occurrence of each key, which preserves today's exact effective config, and drops the dead typo key:

```bash
ssh root@srv1073822.hstgr.cloud "awk -F= '/^[A-Z_]+=/{k=\$1; last[k]=NR} {line[NR]=\$0} END{for(i=1;i<=NR;i++){if(line[i] ~ /^[A-Z_]+=/){split(line[i],p,\"=\"); if(last[p[1]]==i) print line[i]}}}' /etc/vps-apps/checkoutwatch.env > /tmp/env.new && sed -i '/^TRAEFIK_CERT_RESOLVER=/d' /tmp/env.new && install -m 600 /tmp/env.new /etc/vps-apps/checkoutwatch.env && rm /tmp/env.new && cut -d= -f1 /etc/vps-apps/checkoutwatch.env | sort | uniq -d"
```

The final command prints nothing if the file is clean.

### 8c. Deploy the new code and apply the env changes

The VPS is still running `ca31316`. This pulls the three new commits and rebuilds. Compose reads `env_file` at container creation, so the same command also picks up §8a/§8b — a plain restart would not.

```bash
ssh root@srv1073822.hstgr.cloud "cd /opt/vps-apps/project-checkoutwatch && git fetch origin main && git checkout a0792e1 && docker compose --env-file .env.production -f docker-compose.production.yml up -d --build"
```

The worker image rebuild pulls the Playwright base, so allow several minutes. Then verify — both should return 200:

```bash
curl -sS -o /dev/null -w "bot: %{http_code}\n" https://checkoutwatch.srv1073822.hstgr.cloud/bot
curl -sS -o /dev/null -w "privacy: %{http_code}\n" https://checkoutwatch.srv1073822.hstgr.cloud/legal/privacy
```

Optionally publish the egress addresses on `/bot` by adding these to the env file before deploying (the page degrades gracefully without them):

```
PUBLIC_EGRESS_IPV4=72.60.30.172
PUBLIC_EGRESS_IPV6=2a02:4780:2d:f46b::1
```

### 8d. Register the webhooks

`client_id` is already filled in and confirmed, so this is just:

```bash
shopify app deploy
```

**But not before §8f.** `application_url` is `https://checkoutwatch.nickbolles.com`, and deploying while that host 404s points OAuth at somewhere that cannot serve it, breaking the existing `checkout-harbor-lab` install.

Then re-probe every webhook path with an invalid HMAC and confirm 401 on each.

### 8f. Point `checkoutwatch.nickbolles.com` at the VPS (N4)

`*.nickbolles.com` is a wildcard CNAME to `home.nickbolles.com` (`134.215.117.4`, a residential connection), so the subdomain currently answers 404. AlertProof works because it has an explicit A record that overrides the wildcard. CheckoutWatch needs the same one, in whatever DNS provider hosts `nickbolles.com`:

```
checkoutwatch.nickbolles.com.  A  72.60.30.172
```

Verify from anywhere:

```bash
dig +short checkoutwatch.nickbolles.com A
```

It must return `72.60.30.172` and nothing else. Then cut the deployment over — Traefik requests the Let's Encrypt certificate automatically on first request for the new host:

```bash
ssh root@srv1073822.hstgr.cloud "sed -i 's|^PUBLIC_HOST=.*|PUBLIC_HOST=checkoutwatch.nickbolles.com|; s|^SHOPIFY_APP_URL=.*|SHOPIFY_APP_URL=https://checkoutwatch.nickbolles.com|' /etc/vps-apps/checkoutwatch.env && cd /opt/vps-apps/project-checkoutwatch && docker compose --env-file .env.production -f docker-compose.production.yml up -d"
```

`shopify.app.toml` already lists callback URLs for **both** hosts, so OAuth keeps working across the cutover. Drop the `srv1073822` entries once the move is verified.

Note that `skuforge.nickbolles.com` has the identical problem and is presumably also meant to have a record.

### 8g. Restore from a backup

Backups land in `/var/backups/checkoutwatch/`, encrypted with `/etc/vps-apps/checkoutwatch-backup.key`. **Keep a copy of that key off this host** — a backup encrypted with a key that only lives on the machine being backed up protects against nothing. The same applies to `ENCRYPTION_KEY` in the env file: without it the `Shop.accessToken` column in any restored dump is unreadable.

Restore into a scratch database and diff before pointing the app at it — the dump carries `--clean --if-exists`, so restoring straight over a live database destroys it if the dump is bad:

```bash
ssh root@srv1073822.hstgr.cloud "docker exec checkoutwatch-postgres-1 psql -U checkoutwatch -d postgres -c 'CREATE DATABASE cw_restore_test;' && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:/etc/vps-apps/checkoutwatch-backup.key -in \$(ls -t /var/backups/checkoutwatch/*.enc | head -1) | gunzip | docker exec -i checkoutwatch-postgres-1 psql -U checkoutwatch -d cw_restore_test"
```

### 8e. Credentials still needed

| Credential                    | Why                                                                      | Status                                  |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| Shopify client ID + secret    | Resolves Blocker 1; unblocks `shopify app deploy`                        | **Waiting on you**                      |
| **Fresh Resend API key**      | The deployed one is invalid (N1). Without it there are no alerts at all. | **Waiting on you**                      |
| Resend webhook signing secret | Verifies `/webhooks/resend` delivery callbacks                           | Present, but re-issue alongside the key |
| `ANTHROPIC_API_KEY`           | Turns on AI diagnosis, a paid-tier entitlement                           | Not set                                 |

---

## 7. After submission

Ordered by value, from `GAP_REPORT.md` §B and `PLAN.md`:

1. **S3 artifact store** (P2-6) — hard-caps the fleet at one worker until it exists. First real scaling constraint.
2. **Agency multi-store** — named as the biggest revenue lever.
3. **Remaining P2 items** if not landed in D5.
4. **Public "Shopify status — actually tested" marketing page** — the distribution asset `PLAN.md` argues is part of the product, not an afterthought. `README.md` is explicit that a listing alone does not convert here (a competing app had zero reviews 17 months post-launch).
5. **Re-verify the competitor pricing wedge** (Uptime $29/$99/$299) — `README.md` asks for this to be re-checked at build time, and it hasn't been since July.
6. **Shared edge rate limiter** for the status page — the 60s cache and limiter are per-process, so they only hold with one web replica.

---

## Appendix — verification log (2026-08-12)

Everything asserted above was checked directly, not inferred:

```
pnpm test                          → 114 passed | 7 skipped | 0 failed (32 files)
git rev-list HEAD...origin/main    → local was 8 behind; fast-forwarded to 9945336
docker ps                          → cw-{web,worker,postgres,redis} all Up 12 days (healthy)
GET  /healthz                      → 200 {"ok":true,"service":"web"}
GET  /status/does-not-exist        → 404
POST /webhooks/app/uninstalled     → 401 (bogus HMAC) · 400 (missing topic)
openssl s_client                   → CN=checkoutwatch.srv1073822.hstgr.cloud
                                     Let's Encrypt, notAfter 2026-10-19
psql "Shop"                        → dev-shop.myshopify.com (2026-07-21, seed)
                                     checkout-harbor-lab.myshopify.com (2026-07-25)
psql counts                        → Monitor 0 · CheckRun 0 · Incident 0 · Session 1
worker chromium.launch()           → chromium 138.0.7204.23
  → goto checkout-harbor-lab       → HTTP 200
docker exec web printenv           → SHOPIFY_AUTH=real · ALERT_TRANSPORT=mock
                                     CONTROL_PROBE_URL=http://web:3000/healthz
                                     DIAGNOSIS_PROVIDER=heuristic · QUEUE_PREFIX=checkoutwatch
                                     SHOPIFY_API_KEY=b56a051c… (≠ stated 0c357b79…)
worker logs                        → "scheduler tick completed" runs:0, every 30s, for 12 days
grep TODO|FIXME|stub               → 0 hits across apps/ packages/ fixtures/
grep registerWebhooks|afterAuth    → 0 hits
find -name "*.toml"                → only prisma migration_lock.toml
```
