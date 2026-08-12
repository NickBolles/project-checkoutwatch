# Progress

## 2026-07-24 — VPS hosting baseline

- Hosted release verified at `9f629f1a4d9cdb8a4832e5eb6f9b61d730f73ae4`.
- PostgreSQL, Redis, web, and worker are healthy; the database migration exited successfully.
- Traefik routing and public HTTPS health checks are verified.
- Brand recommendation is **Checkout Harbor** before public launch; do not purchase or reconfigure domains until registrar availability and trademark clearance are complete.

## 2026-08-12 — Launch readiness audit

Full audit of repo, tests, deployment, and the live VPS. See [`LAUNCH_PLAN.md`](./LAUNCH_PLAN.md) for the sequenced plan; summary:

- `pnpm test` green — 114 passed, 7 skipped (Redis-only), 0 failed. No `TODO`/`FIXME`/stub markers in source.
- Deployment healthy: web, worker, Postgres, and Redis up 12 days; Let's Encrypt cert valid through 2026-10-19; `/healthz` 200; invalid-HMAC webhook probe correctly rejected with 401; unknown status slug 404.
- **Verified live:** Chromium 138.0.7204.23 launches inside the production worker image and reaches `checkout-harbor-lab.myshopify.com` over HTTPS (200). The heaviest infrastructure risk is retired.
- **Blockers found:** (1) deployed `SHOPIFY_API_KEY` does not match the client ID on record — needs human confirmation; (2) **no `shopify.app.toml` and no programmatic registration**, so no Shopify webhook subscription has ever been created — the GDPR trio, `app/uninstalled`, and `app_subscriptions/update` never fire; (3) `CONTROL_PROBE_URL` points at our own web container, which inverts the false-positive protection it exists to provide; (4) `ALERT_TRANSPORT=mock` in production, so no alert can reach a merchant; (5) 0 monitors and 0 check runs in the production database — the product has never run against a real store; (6) no App Store listing assets or privacy policy; (7) the Shopify automated-traffic policy review required by `COMPLIANCE.md` is still outstanding.

## Next gate

Run a real Shopify development-store integration: Partner app/OAuth, offline-token persistence, verified webhooks, a safe checkout canary, and a controlled incident/alert drill. This is a test-store milestone, not public merchant launch approval. Sequenced in [`LAUNCH_PLAN.md`](./LAUNCH_PLAN.md) §3.
