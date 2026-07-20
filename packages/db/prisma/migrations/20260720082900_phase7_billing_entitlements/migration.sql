/*
  Warnings:

  - Added the required column `updatedAt` to the `BillingSubscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "EntitlementLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'skipped',
    "reason" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntitlementLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BillingSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "shopifySubscriptionId" TEXT,
    "status" TEXT NOT NULL,
    "activatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BillingSubscription" ("activatedAt", "id", "plan", "shopId", "shopifySubscriptionId", "status") SELECT "activatedAt", "id", "plan", "shopId", "shopifySubscriptionId", "status" FROM "BillingSubscription";
DROP TABLE "BillingSubscription";
ALTER TABLE "new_BillingSubscription" RENAME TO "BillingSubscription";
CREATE UNIQUE INDEX "BillingSubscription_shopId_key" ON "BillingSubscription"("shopId");
CREATE TABLE "new_Monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productHandle" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantId" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runningAt" DATETIME,
    "lastRunAt" DATETIME,
    "lastStatus" TEXT,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "openIncidentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Monitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Monitor" ("consecutiveErrors", "consecutiveFails", "enabled", "id", "intervalMinutes", "lastRunAt", "lastStatus", "name", "nextRunAt", "openIncidentId", "productHandle", "productTitle", "runningAt", "shopId", "variantId") SELECT "consecutiveErrors", "consecutiveFails", "enabled", "id", "intervalMinutes", "lastRunAt", "lastStatus", "name", "nextRunAt", "openIncidentId", "productHandle", "productTitle", "runningAt", "shopId", "variantId" FROM "Monitor";
DROP TABLE "Monitor";
ALTER TABLE "new_Monitor" RENAME TO "Monitor";
CREATE UNIQUE INDEX "Monitor_openIncidentId_key" ON "Monitor"("openIncidentId");
CREATE INDEX "Monitor_enabled_nextRunAt_idx" ON "Monitor"("enabled", "nextRunAt");
CREATE INDEX "Monitor_shopId_idx" ON "Monitor"("shopId");
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "storefrontUrl" TEXT NOT NULL,
    "accessToken" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "reconciliationJson" TEXT NOT NULL DEFAULT '{}',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);
INSERT INTO "new_Shop" ("accessToken", "id", "installedAt", "plan", "settingsJson", "shopDomain", "storefrontUrl", "uninstalledAt") SELECT "accessToken", "id", "installedAt", "plan", "settingsJson", "shopDomain", "storefrontUrl", "uninstalledAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EntitlementLog_shopId_createdAt_idx" ON "EntitlementLog"("shopId", "createdAt");
