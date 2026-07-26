import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const protectedRouteFiles = [
  "app._index.tsx",
  "app.settings.tsx",
  "app.settings.alerts.tsx",
  "app.settings.status-page.tsx",
  "app.monitors.new.tsx",
  "app.monitors.$id.tsx",
  "app.incidents.$id.tsx",
  "app.billing.tsx",
];

describe("embedded app navigation", () => {
  it("uses React Router callbacks instead of document-navigation URL props", async () => {
    for (const file of protectedRouteFiles) {
      const source = await readFile(new URL(`../app/routes/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\burl\s*[:=]/);
      expect(source, file).toContain("useNavigate");
    }
  });
});
