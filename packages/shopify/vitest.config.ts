import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "shopify", environment: "node", include: ["test/**/*.test.ts"] },
});
