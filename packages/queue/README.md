# CheckoutWatch job queue

`JobQueue` has memory and BullMQ drivers under one contract: FIFO delivery, delay, retry/backoff, concurrency limits, and `jobId` deduplication. The shared tests always exercise memory and exercise BullMQ when `REDIS_URL` points to a reachable local Redis instance. A Redis-backed contract run is required before production deployment.

The scheduler remains database-driven, so neither driver owns repeat schedules. In development, use either `INLINE_WORKER=1` in the web process or `pnpm worker`; never run both with the in-memory queue because they are separate process-local queues.
