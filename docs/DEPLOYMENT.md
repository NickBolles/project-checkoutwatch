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

Production must use Postgres. Change the Prisma datasource provider in `packages/db/prisma/schema.prisma` from `sqlite` to `postgresql`, set `DATABASE_URL=postgresql://...`, regenerate the Prisma client, and create/review a production migration. Preserve the portable string-backed JSON columns. Add a Postgres partial unique index for one open incident per monitor as defense in depth in addition to `Monitor.openIncidentId @unique`. Run `pnpm db:generate` and the deployment migration command against a staging database before production.

## 3. Provision Redis and the worker

Set `REDIS_URL` and `QUEUE_DRIVER=bullmq`. Deploy exactly one or more standalone worker processes with `pnpm worker`; do not also set `INLINE_WORKER=1`. Set `INLINE_WORKER=0` on both web and worker deployments. Run the BullMQ contract suite against the production Redis class before launch. `ENGINE_CONCURRENCY` controls Chromium concurrency. Expose the worker's `WORKER_HEALTH_PORT` (default 3001) only to the platform health checker at `/healthz`.

## 4. Configure alerts and diagnosis

- Resend: verify the sending domain, set `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, set `ALERT_TRANSPORT=real`, and register `/webhooks/resend`. The secret is consumed by `ResendEmailAdapter`, which verifies Svix signatures and replay timestamps.
- Twilio: complete sender/A2P registration, then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`; register the delivery callback at `/webhooks/twilio`. The adapter verifies Twilio HMAC signatures. SMS remains Pro-only.
- Slack and Discord use merchant-provided webhook URLs; no global credential is required.
- Anthropic: set `ANTHROPIC_API_KEY`, optionally set `LLM_MODEL`, and set `DIAGNOSIS_PROVIDER=anthropic`. Without it the deterministic heuristic stays active. Diagnosis failure never delays the initial alert.

## 5. Install Playwright and deploy

Install Node 20+ and pnpm, run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium` (plus the OS dependency command required by the target Linux image). Set `ARTIFACT_STORE=local` and a persistent `ARTIFACT_DIR` only for a single durable worker; multi-replica production requires the planned S3-compatible artifact-store adapter before scaling. Build with `pnpm build`, run migrations, deploy web and worker separately, and health-check web `/healthz` plus worker `/healthz` on `WORKER_HEALTH_PORT`.

Required production variables: `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=bullmq`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`, `SHOPIFY_AUTH=real`, `ENCRYPTION_KEY`, provider credentials for enabled real channels, `ALERT_TRANSPORT=real`, and `INLINE_WORKER=0`. Optional: `ANTHROPIC_API_KEY`, `LLM_MODEL`, interval/debounce tuning, artifact paths, control probe, and payment-origin configuration. See `.env.example` for every default and exact spelling.

## 6. Preflight and rollout

Run typecheck, lint, the full unit suite, engine suite, and E2E suite with no credentials first. In staging, verify billing callbacks, all webhook rejection cases, Redis redelivery/idempotency, browser launch, the control probe, alert delivery status callbacks, retention, and graceful shutdown. Publish stable egress IPs and complete the live Shopify automated-traffic policy review described in `COMPLIANCE.md`. The 60-second status-page cache and rate limiter are per web process; use a shared edge/cache rate limiter when running multiple replicas.
