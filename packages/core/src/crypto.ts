import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function encrypt(plaintext: string, encodedKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseEncryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decrypt(payload: string, encodedKey: string): string {
  const [version, ivValue, authTagValue, ciphertextValue, ...extra] = payload.split(".");
  if (
    version !== FORMAT_VERSION ||
    !ivValue ||
    !authTagValue ||
    ciphertextValue === undefined ||
    extra.length > 0
  ) {
    throw new Error("Encrypted value has an unsupported or malformed format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    parseEncryptionKey(encodedKey),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function ensureDevelopmentEncryptionKey(envFile = resolve(process.cwd(), ".env")): string {
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^ENCRYPTION_KEY=(.+)$/m);
    if (match?.[1]) {
      parseEncryptionKey(match[1]);
      return match[1];
    }
  }

  const key = generateEncryptionKey();
  const prefix = existsSync(envFile) && readFileSync(envFile, "utf8").length > 0 ? "\n" : "";
  appendFileSync(
    envFile,
    `${prefix}# Auto-generated development-only token encryption key.\nENCRYPTION_KEY=${key}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  return key;
}
