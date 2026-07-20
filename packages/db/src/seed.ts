import { getConfig, logger } from "@checkoutwatch/core";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "./client.js";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));

const config = getConfig();
const client = createPrismaClient(config.databaseUrl);

async function seed(): Promise<void> {
  const shop = await client.shop.upsert({
    where: { shopDomain: "dev-shop.myshopify.com" },
    update: { storefrontUrl: config.fixtureStorefrontUrl },
    create: {
      shopDomain: "dev-shop.myshopify.com",
      storefrontUrl: config.fixtureStorefrontUrl,
      plan: "free",
    },
  });

  const existingMonitor = await client.monitor.findFirst({
    where: { shopId: shop.id, name: "Development checkout" },
  });

  const monitor = existingMonitor
    ? await client.monitor.update({
        where: { id: existingMonitor.id },
        data: {
          productHandle: "checkoutwatch-test-product",
          productTitle: "CheckoutWatch Test Product",
        },
      })
    : await client.monitor.create({
        data: {
          shopId: shop.id,
          name: "Development checkout",
          productHandle: "checkoutwatch-test-product",
          productTitle: "CheckoutWatch Test Product",
          intervalMinutes: 60,
        },
      });

  logger.info({ shopId: shop.id, monitorId: monitor.id }, "development data seeded");
}

try {
  await seed();
} catch (error: unknown) {
  logger.error({ err: error }, "database seed failed");
  process.exitCode = 1;
} finally {
  await client.$disconnect();
}
