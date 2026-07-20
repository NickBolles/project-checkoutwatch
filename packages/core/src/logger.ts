import { pino, type Logger, type LoggerOptions } from "pino";

const defaultOptions: LoggerOptions = {
  level: "info",
  base: null,
  redact: {
    paths: [
      "accessToken",
      "*.accessToken",
      "authorization",
      "*.authorization",
      "apiKey",
      "*.apiKey",
      "authToken",
      "*.authToken",
    ],
    censor: "[REDACTED]",
  },
};

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return pino(defaultOptions).child(bindings);
}

export const logger = createLogger({ service: "checkoutwatch" });
