-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ENGLISH', 'HINDI', 'KANNADA', 'TAMIL', 'TELUGU', 'MALAYALAM', 'MARATHI', 'BENGALI', 'GUJARATI', 'URDU', 'PUNJABI', 'ODIA');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'WEEKENDS', 'SUNDAY_ONLY');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY');

-- CreateTable
CREATE TABLE "publishers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newspapers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "coverImageUrl" TEXT,
    "publisherId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newspapers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newspaper_editions" (
    "id" UUID NOT NULL,
    "newspaperId" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "servicePincodes" TEXT[],
    "pricePerIssuePaise" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newspaper_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "deliveryAddressId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "frequency" "DeliveryFrequency" NOT NULL DEFAULT 'DAILY',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "startDate" DATE NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "pricePerIssuePaiseAtSubscription" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_pauses" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "pausedFrom" DATE NOT NULL,
    "resumedFrom" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "publishers_name_key" ON "publishers"("name");

-- CreateIndex
CREATE INDEX "newspapers_language_idx" ON "newspapers"("language");

-- CreateIndex
CREATE UNIQUE INDEX "newspapers_publisherId_name_language_key" ON "newspapers"("publisherId", "name", "language");

-- CreateIndex
CREATE INDEX "newspaper_editions_city_idx" ON "newspaper_editions"("city");

-- CreateIndex
CREATE INDEX "newspaper_editions_servicePincodes_idx" ON "newspaper_editions" USING GIN ("servicePincodes");

-- CreateIndex
CREATE UNIQUE INDEX "newspaper_editions_newspaperId_city_key" ON "newspaper_editions"("newspaperId", "city");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_editionId_idx" ON "subscriptions"("editionId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscription_pauses_subscriptionId_pausedFrom_idx" ON "subscription_pauses"("subscriptionId", "pausedFrom");

-- AddForeignKey
ALTER TABLE "newspapers" ADD CONSTRAINT "newspapers_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newspaper_editions" ADD CONSTRAINT "newspaper_editions_newspaperId_fkey" FOREIGN KEY ("newspaperId") REFERENCES "newspapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "newspaper_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_pauses" ADD CONSTRAINT "subscription_pauses_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- A price is never negative. A negative price per issue would turn a subscription
-- into a cashback source and quietly drain the wallet ledger in Phase 4.
ALTER TABLE "newspaper_editions"
  ADD CONSTRAINT "newspaper_editions_price_non_negative"
  CHECK ("pricePerIssuePaise" >= 0);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_price_non_negative"
  CHECK ("pricePerIssuePaiseAtSubscription" >= 0);

-- A pause cannot resume before it began. Proration counts the issues inside
-- [pausedFrom, resumedFrom), so an inverted window would produce a NEGATIVE issue
-- count and hand the customer a credit for a month they were served.
ALTER TABLE "subscription_pauses"
  ADD CONSTRAINT "subscription_pauses_window_ordered"
  CHECK ("resumedFrom" IS NULL OR "resumedFrom" >= "pausedFrom");

-- At most ONE open pause per subscription. Two open windows would be double-counted
-- by the billing period calculation, crediting the same skipped issues twice.
CREATE UNIQUE INDEX "subscription_pauses_one_open_per_subscription"
  ON "subscription_pauses" ("subscriptionId")
  WHERE "resumedFrom" IS NULL;
