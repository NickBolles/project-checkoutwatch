import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateEncryptionKey } from "../src/crypto.js";

describe("token encryption", () => {
  it("round-trips with AES-256-GCM", () => {
    const key = generateEncryptionKey();
    const encrypted = encrypt("shopify-secret-token", key);

    expect(encrypted).not.toContain("shopify-secret-token");
    expect(decrypt(encrypted, key)).toBe("shopify-secret-token");
  });

  it("rejects tampered ciphertext", () => {
    const key = generateEncryptionKey();
    const encrypted = encrypt("token", key);

    expect(() => decrypt(`${encrypted}x`, key)).toThrow();
  });
});
