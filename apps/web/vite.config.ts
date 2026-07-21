import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  ssr: {
    // Playwright's CommonJS dependency tree depends on __dirname.  Keep it in
    // node_modules so the ESM server bundle does not execute a transformed copy.
    external: ["playwright"],
  },
});
