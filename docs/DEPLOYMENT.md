# CheckoutWatch production deployment

This runbook turns the credential-free repository into a production deployment. Never commit credentials; provide them through the hosting platform's encrypted environment-variable store.

## 1. Create the Shopify Partner app

1. In Shopify Partners, create a public app and set the application URL to the production HTTPS origin.
2. Configure the embedded app redirect/callback URLs required by the current React Router Shopify template.
3. Request `read_products,read_themes`; do not add scopes without a product requirement and review.
4. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`, and `SHOPIFY_AUTH=real`. The web app consumes these in `apps/web/app/shopify.server.ts` and `auth.server.ts`.
5. Generate a stable base64-encoded 32-byte `ENCRYPTION_KEY`. It encrypts stored Shopify access tokens; losing it makes those tokens unreadable.

Register HTTPS POST webhooks and use the exact production origin:

| Topic                      | Path                                 |
| -------------------------- | ------------------------------------ |
| `app/uninstalled`          | `/webhooks/app/uninstalled`          |
| `customers/data_request`   | `/webhooks/customers/data_request`   |
| `customers/redact`         | `/webhooks/customers/redact`         |
| `shop/redact`              | `/webhooks/shop/redact`              |
| `app_subscriptions/update` | `/webhooks/app_subscriptions/update` |

All Shopify routes verify `X-Shopify-Hmac-Sha256` over the raw body with `SHOPIFY_API_SECRET`. Test invalid signatures before launch.

## 2. Provision Postgres and migrate

Production must use Postgres. Keep the checked-in portable schema on SQLite for local tests; `pnpm db:generate:postgres`, `pnpm db:check:postgres`, and `pnpm db:push:postgres` generate and validate the equivalent PostgreSQL schema under the ignored `packages/db/prisma/generated/` directory. Review the generated SQL/migration plan and use a migration-based rollout rather than `db push` for an established production database. Add a Postgres partial unique index for one open incident per monitor as defense in depth in addition to `Monitor.openIncidentId @unique`.

## 3. Provision Redis and the worker

Set `REDIS_URL`, `QUEUE_DRIVER=bullmq`, and one stable `QUEUE_PREFIX` shared by every web and worker replica (default `checkoutwatch`). Never derive or template the prefix from a process/container id. Deploy exactly one or more standalone worker processes with `pnpm worker`; do not also set `INLINE_WORKER=1`. Set `INLINE_WORKER=0` on both web and worker deployments. Run `REDIS_URL=redis://... pnpm --filter @checkoutwatch/queue test` against the production Redis class before launch; this includes web-to-worker consumption and cross-instance cancellation. `ENGINE_CONCURRENCY` controls Chromium concurrency. Expose the worker's `WORKER_HEALTH_PORT` (default 3001) only to the platform health checker at `/healthz`.

In real Shopify mode the worker decrypts each installed shop's stored offline access token and polls the Admin GraphQL API for main-theme changes. Verify that an authenticated app request has stored an offline token before enabling monitoring; missing or undecryptable tokens fail the poll closed and are never replaced with fixture data.

## 4. Configure alerts and diagnosis

- Resend: verify the sending domain, set `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, set `ALERT_TRANSPORT=real`, and register `/webhooks/resend`. The secret is consumed by `ResendEmailAdapter`, which verifies Svix signatures and replay timestamps.
- Twilio: complete sender/A2P registration, then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`; register the delivery callback at `/webhooks/twilio`. The adapter verifies Twilio HMAC signatures. SMS remains Pro-only.
- Slack and Discord use merchant-provided webhook URLs; no global credential is required.
- Anthropic: set `ANTHROPIC_API_KEY`, optionally set `LLM_MODEL`, and set `DIAGNOSIS_PROVIDER=anthropic`. Without it the deterministic heuristic stays active. Diagnosis failure never delays the initial alert.

## 5. Container deployment

Build `apps/web/Dockerfile` for the React Router server and `apps/worker/Dockerfile` for the worker. The worker image is pinned to the Playwright 1.53.1 Jammy image, matching `packages/engine`, so Chromium and its OS libraries stay version-aligned. The web image uses Node 20. Both images generate the PostgreSQL Prisma client during their build.

`docker-compose.yml` is the credential-free prod-parity topology: it starts PostgreSQL, Redis, the local fixture/control probe, a schema-init service, web, and the Playwright worker with mock Shopify and alert transports. It is for local/CI validation only; its fixture control probe is deliberately invalid for a real deployment.

For the Hostinger + Traefik deployment, use the tracked `docker-compose.production.yml` and a VPS-local `.env.production` created from `.env.production.example`:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Fill every REPLACE_WITH_* value and set the actual Traefik network/resolver.
docker compose --env-file .env.production -f docker-compose.production.yml config
# First deployment only: this initializes the empty Postgres volume with Prisma db push.
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

The production topology has no fixture, publishes only the web service through Traefik, keeps Postgres/Redis/worker health private, and uses a shared durable artifact volume for **one** worker. The worker additionally joins a non-internal `egress` network so Playwright storefront checks, Shopify theme polling, the independent control probe, and enabled alert providers can reach the public Internet; it has no published ports and is not attached to Traefik. Its `migrate` service invokes `pnpm db:push:postgres`, which is appropriate only while the database is new and disposable; create and apply reviewed Prisma migrations before upgrading an established production database. Multi-replica production requires the planned S3-compatible artifact-store adapter before scaling. Health-check web `/healthz` and worker `/healthz` on `WORKER_HEALTH_PORT`.

Required production variables: `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=bullmq`, stable shared `QUEUE_PREFIX`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`, `SHOPIFY_AUTH=real`, `ENCRYPTION_KEY`, `CONTROL_PROBE_URL`, provider credentials for enabled real channels, `ALERT_TRANSPORT=real`, and `INLINE_WORKER=0`. `CONTROL_PROBE_URL` must be an independently hosted, known-good HTTPS endpoint; production startup rejects a missing or loopback value. Optional: `ANTHROPIC_API_KEY`, `LLM_MODEL`, interval/debounce tuning, artifact paths, and payment-origin configuration. See `.env.example` for every default and exact spelling.

The control probe is used only to classify an origin connection/DNS/TLS failure during `visit_product`: control passes means `STORE_UNREACHABLE` and remains alertable; control fails means CheckoutWatch cannot judge and records `CONTROL_PROBE_FAILED` as non-alertable `error`. A store failure later in the checkout walk remains an alertable step timeout/failure.

## 6. Preflight and rollout

Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` with no credentials first. In staging, run the Redis-backed queue contract command from section 3, verify billing callbacks and all webhook rejection cases, launch Chromium from the worker image, and perform a store-down drill: stop the fixture/store origin while leaving the independent control endpoint healthy, then confirm two `STORE_UNREACHABLE` runs open an incident and enqueue an alert. Also verify alert delivery callbacks, retention, and graceful shutdown. Publish stable egress IPs and complete the live Shopify automated-traffic policy review described in `COMPLIANCE.md`. The 60-second status-page cache and rate limiter are per web process; use a shared edge/cache rate limiter when running multiple replicas.

## 7. Continuous integration

`.github/workflows/ci.yml` has a credential-free quality lane (install, SQLite migration/seed, Chromium install, typecheck, lint, full tests, and build) and a prod-parity lane. The prod-parity lane validates and applies the generated schema to PostgreSQL, runs the cross-instance BullMQ contract against Redis, validates Compose, and builds both production images.
