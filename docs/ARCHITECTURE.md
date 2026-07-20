# CheckoutWatch architecture

CheckoutWatch is a pnpm TypeScript monorepo with a React Router Shopify web process, a queue-backed worker, Prisma persistence, and a Playwright checkout engine. The web process owns merchant UI, authenticated settings and webhook ingress; `/status/:slug` and `/healthz` are intentionally unauthenticated. The worker owns scheduling, browser execution, incident transitions, diagnosis, alert dispatch, retention, and store-change polling.

The queue port has memory and BullMQ drivers. Atomic schedule claims and per-monitor `runningAt` locks prevent duplicate or overlapping checks. Job IDs and database uniqueness make at-least-once delivery idempotent. Structured job logs act as the minimum dead-letter record; production log routing must alert on the `job failed` event after queue attempts are exhausted. Scheduler catch-up is capped to one current job per due monitor and a bounded batch, so downtime cannot replay every missed interval.

Run outcomes are `passed`, `failed`, or `error`. Only merchant-impacting failures enter the debounce/incident machine. Store unreachability is a failure only when the independent control probe succeeds. Engine and network-control errors are no-signal and excluded from uptime. Public status data is constructed from an allowlisted DTO and never includes raw diagnosis, evidence, errors, URLs, artifacts, credentials, or store internals.

Artifacts use a local store for development. Production multi-worker deployment requires an S3-compatible implementation. Retention is plan-based and preserves incident-opening and incident-resolving runs. Alert delivery is isolated in the portable `packages/alerts` contract with claim-before-send state transitions and adapter-owned status-webhook verification.
