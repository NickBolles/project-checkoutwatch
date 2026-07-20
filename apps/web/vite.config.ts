import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  // Browser automation belongs to the worker image. Externalizing it keeps Vite
  // from traversing Playwright's optional BiDi mapper in the web server bundle.
  ssr: { external: ["playwright", "playwright-core"] },
});
