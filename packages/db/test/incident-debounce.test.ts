import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, PrismaIncidentRepository } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function seed(runs: Array<{ status: string; failureCode?: string }>) {
  const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-debounce-"));
  const databasePath = join(directory, "test.db");
  await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
  const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
  cleanups.push(async () => {
    await client.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  const shop = await client.shop.create({
    data: { shopDomain: `debounce-${Date.now()}.test`, storefrontUrl: "http://localhost:4600" },
  });
  const monitor = await client.monitor.create({
    data: {
      shopId: shop.id,
      name: "checkout",
      productHandle: "test-product",
      productTitle: "Fixture",
    },
  });

  // Oldest first, so the newest run is the one we load state for.
  const base = Date.now() - runs.length * 60_000;
  const created = [];
  for (const [index, run] of runs.entries()) {
    created.push(
      await client.checkRun.create({
        data: {
          monitorId: monitor.id,
          status: run.status,
          startedAt: new Date(base + index * 60_000),
          ...(run.failureCode ? { failureCode: run.failureCode } : {}),
        },
      }),
    );
  }
  return { repository: new PrismaIncidentRepository(client), runs: created };
}

describe("consecutive-failure debounce", () => {
  it("does not let a sold-out run carry a checkout failure to the paging threshold", async () => {
    // sold out -> transient 5xx. Only ONE checkout failure has been observed, so the
    // machine must still be at 1 and take the recheck branch rather than paging.
    const { repository, runs } = await seed([
      { status: "passed" },
      { status: "failed", failureCode: "PRODUCT_UNAVAILABLE" },
      { status: "failed", failureCode: "CHECKOUT_HTTP_5XX" },
    ]);

    const state = await repository.loadRunState(runs[2]!.id);
    expect(state.monitor.consecutiveFails).toBe(0);
  });

  it("still counts two genuine checkout failures", async () => {
    const { repository, runs } = await seed([
      { status: "passed" },
      { status: "failed", failureCode: "CHECKOUT_HTTP_5XX" },
      { status: "failed", failureCode: "CHECKOUT_HTTP_5XX" },
    ]);

    const state = await repository.loadRunState(runs[2]!.id);
    expect(state.monitor.consecutiveFails).toBe(1);
  });

  it("keeps error runs from breaking a genuine failure streak", async () => {
    const { repository, runs } = await seed([
      { status: "failed", failureCode: "CHECKOUT_HTTP_5XX" },
      { status: "error", failureCode: "CONTROL_PROBE_FAILED" },
      { status: "failed", failureCode: "CHECKOUT_HTTP_5XX" },
    ]);

    const state = await repository.loadRunState(runs[2]!.id);
    expect(state.monitor.consecutiveFails).toBe(1);
  });

  it("counts sold-out runs on their own attention counter", async () => {
    const { repository, runs } = await seed([
      { status: "failed", failureCode: "PRODUCT_UNAVAILABLE" },
      { status: "failed", failureCode: "PRODUCT_UNAVAILABLE" },
      { status: "failed", failureCode: "PRODUCT_UNAVAILABLE" },
    ]);

    const state = await repository.loadRunState(runs[2]!.id);
    expect(state.consecutiveProductUnavailable).toBe(2);
    expect(state.monitor.consecutiveFails).toBe(0);
  });
});
