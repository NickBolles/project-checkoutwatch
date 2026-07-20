import { afterAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createPrismaClient } from "../src/client.js";

const databasePath = resolve(import.meta.dirname, "../../../var/dev.db").replaceAll("\\", "/");
const client = createPrismaClient(`file:${databasePath}`);

afterAll(async () => {
  await client.$disconnect();
});

describe("seeded database", () => {
  it("queries the development shop and monitor", async () => {
    const shop = await client.shop.findUnique({
      where: { shopDomain: "dev-shop.myshopify.com" },
      include: { monitors: true },
    });

    expect(shop?.storefrontUrl).toBe("http://localhost:4600");
    expect(shop?.monitors).toHaveLength(1);
    expect(shop?.monitors[0]?.productHandle).toBe("checkoutwatch-test-product");
  });
});
