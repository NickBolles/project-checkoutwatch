import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.js";

describe("parseEnv", () => {
  it("provides zero-credential local defaults", () => {
    const config = parseEnv({});

    expect(config).toMatchObject({
      databaseUrl: "file:./var/dev.db",
      queueDriver: "memory",
      alertTransport: "mock",
      diagnosisProvider: "heuristic",
      shopifyAuth: "mock",
      engineConcurrency: 2,
      inlineWorker: true,
    });
    expect(Buffer.from(config.encryptionKey, "base64")).toHaveLength(32);
  });

  it("accepts explicit overrides and derives real adapters from credential presence", () => {
    const config = parseEnv({
      REDIS_URL: "redis://localhost:6379",
      SHOPIFY_API_KEY: "key",
      SHOPIFY_API_SECRET: "secret",
      ANTHROPIC_API_KEY: "anthropic",
      RESEND_API_KEY: "resend",
      ENGINE_CONCURRENCY: "4",
      INLINE_WORKER: "false",
    });

    expect(config).toMatchObject({
      queueDriver: "bullmq",
      shopifyAuth: "real",
      diagnosisProvider: "anthropic",
      alertTransport: "real",
      engineConcurrency: 4,
      inlineWorker: false,
    });
  });

  it.each([
    { QUEUE_DRIVER: "sidekiq" },
    { ENGINE_CONCURRENCY: "0" },
    { SHOPIFY_APP_URL: "not-a-url" },
    { INLINE_WORKER: "sometimes" },
    { ENCRYPTION_KEY: "too-short" },
    { QUEUE_DRIVER: "bullmq" },
    { DIAGNOSIS_PROVIDER: "anthropic" },
    { SHOPIFY_AUTH: "real" },
    { NODE_ENV: "production" },
  ])("rejects invalid values: %o", (input) => {
    expect(() => parseEnv(input)).toThrow();
  });
});
