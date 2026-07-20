import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  ensureDevelopmentEncryptionKey,
  generateEncryptionKey,
  parseEncryptionKey,
} from "./crypto.js";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const booleanString = z
  .enum(["0", "1", "false", "true"])
  .default("0")
  .transform((value) => value === "1" || value === "true");

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1).default("file:./var/dev.db"),
    REDIS_URL: optionalString,
    QUEUE_DRIVER: z.enum(["memory", "bullmq"]).optional(),
    QUEUE_PREFIX: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("checkoutwatch"),
    SHOPIFY_API_KEY: optionalString,
    SHOPIFY_API_SECRET: optionalString,
    SHOPIFY_APP_URL: z.string().url().default("http://localhost:3000"),
    SHOPIFY_SCOPES: z.string().min(1).default("read_products,read_themes"),
    SHOPIFY_AUTH: z.enum(["mock", "real"]).optional(),
    SHOPIFY_MOCK_WEBHOOK_SECRET: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    LLM_MODEL: z.string().min(1).default("claude-opus-4-8"),
    DIAGNOSIS_PROVIDER: z.enum(["heuristic", "anthropic"]).optional(),
    RESEND_API_KEY: optionalString,
    RESEND_WEBHOOK_SECRET: optionalString,
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    TWILIO_FROM_NUMBER: optionalString,
    ALERT_TRANSPORT: z.enum(["mock", "real"]).optional(),
    ARTIFACT_STORE: z.enum(["local", "s3"]).default("local"),
    ARTIFACT_DIR: z.string().min(1).default("var/artifacts"),
    ENCRYPTION_KEY: optionalString,
    ENGINE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    RECHECK_DELAY_SECONDS: z.coerce.number().int().min(0).default(90),
    REOPEN_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(30),
    PRODUCT_UNAVAILABLE_AUTOPAUSE: z.coerce.number().int().min(2).default(6),
    INLINE_WORKER: booleanString.default("1"),
    FIXTURE_STOREFRONT_URL: z.string().url().default("http://localhost:4600"),
    CONTROL_PROBE_URL: z.string().url().optional(),
    KNOWN_PAYMENT_ORIGINS: z
      .string()
      .default("https://checkout.shopifycs.com,https://js.stripe.com,http://localhost:4601"),
  })
  .superRefine((value, context) => {
    if (value.ENCRYPTION_KEY) {
      try {
        parseEncryptionKey(value.ENCRYPTION_KEY);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ENCRYPTION_KEY"],
          message: "must be a base64-encoded 32-byte key",
        });
      }
    } else if (value.NODE_ENV === "production") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENCRYPTION_KEY"],
        message: "is required in production",
      });
    }

    if (value.QUEUE_DRIVER === "bullmq" && !value.REDIS_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "is required when QUEUE_DRIVER=bullmq",
      });
    }

    if (value.DIAGNOSIS_PROVIDER === "anthropic" && !value.ANTHROPIC_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "is required when DIAGNOSIS_PROVIDER=anthropic",
      });
    }

    if (value.SHOPIFY_AUTH === "real" && (!value.SHOPIFY_API_KEY || !value.SHOPIFY_API_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SHOPIFY_AUTH"],
        message: "real auth requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET",
      });
    }

    if (value.NODE_ENV === "production") {
      if (!value.CONTROL_PROBE_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CONTROL_PROBE_URL"],
          message: "is required in production",
        });
      } else if (isLoopbackHostname(new URL(value.CONTROL_PROBE_URL).hostname)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CONTROL_PROBE_URL"],
          message: "must not point at localhost or a loopback address in production",
        });
      }
    }
  });

export type QueueDriver = "memory" | "bullmq";
export type AlertTransport = "mock" | "real";
export type DiagnosisProvider = "heuristic" | "anthropic";
export type ShopifyAuth = "mock" | "real";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl?: string;
  queueDriver: QueueDriver;
  queuePrefix: string;
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  shopifyAppUrl: string;
  shopifyScopes: readonly string[];
  shopifyAuth: ShopifyAuth;
  shopifyMockWebhookSecret?: string;
  anthropicApiKey?: string;
  llmModel: string;
  diagnosisProvider: DiagnosisProvider;
  resendApiKey?: string;
  resendWebhookSecret?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  alertTransport: AlertTransport;
  artifactStore: "local" | "s3";
  artifactDir: string;
  encryptionKey: string;
  engineConcurrency: number;
  workerHealthPort: number;
  recheckDelaySeconds: number;
  reopenCooldownMinutes: number;
  productUnavailableAutopause: number;
  inlineWorker: boolean;
  fixtureStorefrontUrl: string;
  controlProbeUrl: string;
  knownPaymentOrigins: readonly string[];
}

export function parseEnv(input: NodeJS.ProcessEnv | Record<string, unknown>): AppConfig {
  const raw = rawEnvSchema.parse(input);
  const queueDriver = raw.QUEUE_DRIVER ?? (raw.REDIS_URL ? "bullmq" : "memory");
  const diagnosisProvider =
    raw.DIAGNOSIS_PROVIDER ?? (raw.ANTHROPIC_API_KEY ? "anthropic" : "heuristic");
  const shopifyAuth =
    raw.SHOPIFY_AUTH ?? (raw.SHOPIFY_API_KEY && raw.SHOPIFY_API_SECRET ? "real" : "mock");
  const alertTransport =
    raw.ALERT_TRANSPORT ??
    (raw.RESEND_API_KEY || (raw.TWILIO_ACCOUNT_SID && raw.TWILIO_AUTH_TOKEN) ? "real" : "mock");

  return {
    nodeEnv: raw.NODE_ENV,
    databaseUrl: raw.DATABASE_URL,
    ...(raw.REDIS_URL ? { redisUrl: raw.REDIS_URL } : {}),
    queueDriver,
    queuePrefix: raw.QUEUE_PREFIX,
    ...(raw.SHOPIFY_API_KEY ? { shopifyApiKey: raw.SHOPIFY_API_KEY } : {}),
    ...(raw.SHOPIFY_API_SECRET ? { shopifyApiSecret: raw.SHOPIFY_API_SECRET } : {}),
    shopifyAppUrl: raw.SHOPIFY_APP_URL,
    shopifyScopes: raw.SHOPIFY_SCOPES.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    shopifyAuth,
    ...(raw.SHOPIFY_MOCK_WEBHOOK_SECRET
      ? { shopifyMockWebhookSecret: raw.SHOPIFY_MOCK_WEBHOOK_SECRET }
      : {}),
    ...(raw.ANTHROPIC_API_KEY ? { anthropicApiKey: raw.ANTHROPIC_API_KEY } : {}),
    llmModel: raw.LLM_MODEL,
    diagnosisProvider,
    ...(raw.RESEND_API_KEY ? { resendApiKey: raw.RESEND_API_KEY } : {}),
    ...(raw.RESEND_WEBHOOK_SECRET ? { resendWebhookSecret: raw.RESEND_WEBHOOK_SECRET } : {}),
    ...(raw.TWILIO_ACCOUNT_SID ? { twilioAccountSid: raw.TWILIO_ACCOUNT_SID } : {}),
    ...(raw.TWILIO_AUTH_TOKEN ? { twilioAuthToken: raw.TWILIO_AUTH_TOKEN } : {}),
    ...(raw.TWILIO_FROM_NUMBER ? { twilioFromNumber: raw.TWILIO_FROM_NUMBER } : {}),
    alertTransport,
    artifactStore: raw.ARTIFACT_STORE,
    artifactDir: raw.ARTIFACT_DIR,
    encryptionKey: raw.ENCRYPTION_KEY ?? generateEncryptionKey(),
    engineConcurrency: raw.ENGINE_CONCURRENCY,
    workerHealthPort: raw.WORKER_HEALTH_PORT,
    recheckDelaySeconds: raw.RECHECK_DELAY_SECONDS,
    reopenCooldownMinutes: raw.REOPEN_COOLDOWN_MINUTES,
    productUnavailableAutopause: raw.PRODUCT_UNAVAILABLE_AUTOPAUSE,
    inlineWorker: raw.INLINE_WORKER,
    fixtureStorefrontUrl: raw.FIXTURE_STOREFRONT_URL,
    controlProbeUrl: raw.CONTROL_PROBE_URL ?? "http://localhost:4602/health",
    knownPaymentOrigins: raw.KNOWN_PAYMENT_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const envPath = resolve(process.cwd(), ".env");
  loadDotenv({ path: envPath });
  if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV !== "production") {
    process.env.ENCRYPTION_KEY = ensureDevelopmentEncryptionKey(envPath);
  }

  cachedConfig = parseEnv(process.env);
  return cachedConfig;
}
