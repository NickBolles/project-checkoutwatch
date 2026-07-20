import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPrismaClient } from "@checkoutwatch/db";
import { createRetentionHandler } from "../src/jobs/retention.js";

const clients: Array<ReturnType<typeof createPrismaClient>> = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.$disconnect())));

describe("Phase 9 retention", () => {
  it("prunes expired runs and orphan artifacts but preserves incident-linked evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "checkoutwatch-retention-"));
    const databasePath = join(directory, "test.db");
    await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
    const client = createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`);
    clients.push(client);
    const artifactRoot = join(directory, "artifacts");
    const shop = await client.shop.create({
      data: { shopDomain: "retention.test", storefrontUrl: "https://retention.test", plan: "free" },
    });
    const monitor = await client.monitor.create({
      data: { shopId: shop.id, name: "Checkout", productHandle: "test", productTitle: "Test" },
    });
    const old = new Date("2026-06-01T00:00:00Z");
    const unlinked = await client.checkRun.create({
      data: {
        id: "expired-run",
        monitorId: monitor.id,
        status: "failed",
        startedAt: old,
        screenshotPath: join(artifactRoot, "expired-run", "failure.png"),
      },
    });
    const linked = await client.checkRun.create({
      data: {
        id: "incident-run",
        monitorId: monitor.id,
        status: "failed",
        startedAt: old,
        screenshotPath: join(artifactRoot, "incident-run", "failure.png"),
      },
    });
    await client.incident.create({
      data: { monitorId: monitor.id, openingRunId: linked.id, failureCode: "CHECKOUT_NOT_REACHED" },
    });
    for (const id of [unlinked.id, linked.id, "orphan-run"]) {
      await mkdir(join(artifactRoot, id), { recursive: true });
      await writeFile(join(artifactRoot, id, "failure.png"), "fixture");
    }
    const result = await createRetentionHandler(client, artifactRoot)(
      {},
      new Date("2026-07-20T00:00:00Z"),
    );
    expect(result).toMatchObject({ deletedRuns: 1, deletedArtifactDirectories: 2 });
    expect(await client.checkRun.findUnique({ where: { id: unlinked.id } })).toBeNull();
    expect(await client.checkRun.findUnique({ where: { id: linked.id } })).not.toBeNull();
  });
});
