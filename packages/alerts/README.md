# `@checkoutwatch/alerts` portability contract

This package is the canonical alert-delivery contract shared by CheckoutWatch and AlertProof. It has no Prisma, Shopify, framework, or application imports. Applications supply persistence through `DeliveryLogStore`; provider configuration and `fetch` are constructor-injected.

## Stable public surface

- `ChannelType`: `email | slack | discord | sms`.
- `DeliveryStatus`: `queued | sending | sent | delivered | bounced | deferred | failed | skipped`.
- `AlertChannelAdapter` owns `send` and, for callback-capable providers, `verifyStatusWebhook` and `parseStatusEvent`.
- `DeliveryLogStore` owns `record`, atomic `claimQueued`, conditional `transition`, and webhook-path `updateStatus`.
- `AlertDispatcher` records each route before I/O, conditionally claims `queued -> sending`, retries at most three times with exponential backoff, and records disabled or plan-gated routes as `skipped`.
- Any destination beginning `mock://` uses `MockAdapter` even when real transport is configured.

AlertProof enum mapping is exact: `queued=PENDING`, `sending=SENDING`, `sent=SENT`, `delivered=DELIVERED`, `bounced=BOUNCED`, `deferred=DEFERRED`, `failed=FAILED`, and `skipped=SKIPPED`. AlertProof should adopt the interface names above; its PostgreSQL `SKIP LOCKED` claim remains an implementation detail of `DeliveryLogStore`.

`record` must deduplicate `(messageKey, channelType, destination)`. `claimQueued` must atomically change claimed entries to `sending`; `transition` must be a conditional compare-and-set and return `false` after a lost race. Provider callbacks are verified and parsed by the adapter before the application looks up the provider message id. A terminal `delivered` status never regresses due to a late callback.

Provider credentials are optional locally. `MockAdapter` appends JSON lines under `var/outbox/<channel>.jsonl`.
