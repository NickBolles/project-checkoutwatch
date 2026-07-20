import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "diagnosis", environment: "node", include: ["test/**/*.test.ts"] },
});
