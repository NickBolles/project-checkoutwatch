import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "alerts", environment: "node", include: ["test/**/*.test.ts"] },
});
