-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "storefrontUrl" TEXT NOT NULL,
    "accessToken" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT
);

-- CreateTable
CREATE TABLE "Monitor" (
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
    CONSTRAINT "Monitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'schedule',
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "stepTimingsJson" TEXT NOT NULL DEFAULT '[]',
    "failureStep" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "screenshotPath" TEXT,
    "consoleJson" TEXT NOT NULL DEFAULT '[]',
    "failedRequestsJson" TEXT NOT NULL DEFAULT '[]',
    "scriptOriginsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "CheckRun_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "openingRunId" TEXT NOT NULL,
    "resolvingRunId" TEXT,
    "failureCode" TEXT NOT NULL,
    "diagnosisJson" TEXT,
    "changeContextJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertChannelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" DATETIME,
    CONSTRAINT "AlertChannelConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "incidentId" TEXT,
    "messageKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorDetail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertDelivery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoreChangeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL,
    CONSTRAINT "StoreChangeEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "shopifySubscriptionId" TEXT,
    "status" TEXT NOT NULL,
    "activatedAt" DATETIME,
    CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "StatusPage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_openIncidentId_key" ON "Monitor"("openIncidentId");

-- CreateIndex
CREATE INDEX "Monitor_enabled_nextRunAt_idx" ON "Monitor"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Monitor_shopId_idx" ON "Monitor"("shopId");

-- CreateIndex
CREATE INDEX "CheckRun_monitorId_startedAt_idx" ON "CheckRun"("monitorId", "startedAt");

-- CreateIndex
CREATE INDEX "Incident_monitorId_status_idx" ON "Incident"("monitorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertChannelConfig_shopId_type_destination_key" ON "AlertChannelConfig"("shopId", "type", "destination");

-- CreateIndex
CREATE INDEX "AlertDelivery_shopId_createdAt_idx" ON "AlertDelivery"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_providerMessageId_idx" ON "AlertDelivery"("providerMessageId");

-- CreateIndex
CREATE INDEX "AlertDelivery_incidentId_idx" ON "AlertDelivery"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_messageKey_channelType_destination_key" ON "AlertDelivery"("messageKey", "channelType", "destination");

-- CreateIndex
CREATE INDEX "StoreChangeEvent_shopId_detectedAt_idx" ON "StoreChangeEvent"("shopId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopId_key" ON "BillingSubscription"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_shopId_key" ON "StatusPage"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_slug_key" ON "StatusPage"("slug");
