import { defineWorkspace } from "vitest/config";

const projects = [
  {
    test: {
      name: "core",
      environment: "node",
      root: "packages/core",
      include: ["test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "db",
      environment: "node",
      root: "packages/db",
      include: ["test/**/*.test.ts"],
      fileParallelism: false,
    },
  },
  ...["alerts", "engine", "diagnosis", "queue", "shopify"].map((name) => ({
    test: {
      name,
      environment: "node" as const,
      root: `packages/${name}`,
      include: ["test/**/*.test.ts"],
    },
  })),
  {
    test: {
      name: "worker",
      environment: "node",
      root: "apps/worker",
      include: ["test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "web",
      environment: "node",
      root: "apps/web",
      include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
      fileParallelism: false,
    },
  },
] as const;

export default defineWorkspace([...projects]);
