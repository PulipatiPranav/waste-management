-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('ON_FOOT', 'BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincodes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_partners" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'BICYCLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_partner_zones" (
    "partnerId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_partner_zones_pkey" PRIMARY KEY ("partnerId","zoneId")
);

-- CreateTable
CREATE TABLE "daily_delivery_runs" (
    "id" UUID NOT NULL,
    "runDate" DATE NOT NULL,
    "partnerId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_delivery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_stops" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "photoKey" TEXT,
    "sequence" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_name_key" ON "delivery_zones"("name");

-- CreateIndex
CREATE INDEX "delivery_zones_city_idx" ON "delivery_zones"("city");

-- CreateIndex
CREATE INDEX "delivery_zones_pincodes_idx" ON "delivery_zones" USING GIN ("pincodes");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_partners_userId_key" ON "delivery_partners"("userId");

-- CreateIndex
CREATE INDEX "delivery_partners_kycStatus_idx" ON "delivery_partners"("kycStatus");

-- CreateIndex
CREATE INDEX "delivery_partner_zones_zoneId_idx" ON "delivery_partner_zones"("zoneId");

-- CreateIndex
CREATE INDEX "daily_delivery_runs_runDate_status_idx" ON "daily_delivery_runs"("runDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_delivery_runs_runDate_partnerId_zoneId_key" ON "daily_delivery_runs"("runDate", "partnerId", "zoneId");

-- CreateIndex
CREATE INDEX "delivery_stops_runId_sequence_idx" ON "delivery_stops"("runId", "sequence");

-- CreateIndex
CREATE INDEX "delivery_stops_status_idx" ON "delivery_stops"("status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_stops_runId_subscriptionId_key" ON "delivery_stops"("runId", "subscriptionId");

-- AddForeignKey
ALTER TABLE "delivery_partners" ADD CONSTRAINT "delivery_partners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_partner_zones" ADD CONSTRAINT "delivery_partner_zones_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_partner_zones" ADD CONSTRAINT "delivery_partner_zones_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_delivery_runs" ADD CONSTRAINT "daily_delivery_runs_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "delivery_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_delivery_runs" ADD CONSTRAINT "daily_delivery_runs_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_runId_fkey" FOREIGN KEY ("runId") REFERENCES "daily_delivery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- A stop's outcome must be explicable. FAILED and SKIPPED require a reason;
-- DELIVERED must not carry one.
--
-- "Failed" with no reason is a support ticket nobody can answer and a delivery dispute
-- nobody can settle — and by Phase 4 a customer will be asking why they were billed for
-- a paper they never received.
ALTER TABLE "delivery_stops"
  ADD CONSTRAINT "delivery_stops_reason_matches_status"
  CHECK (
    ("status" IN ('FAILED', 'SKIPPED') AND "reason" IS NOT NULL AND length(trim("reason")) > 0)
    OR ("status" IN ('PENDING', 'DELIVERED') AND "reason" IS NULL)
  );

-- A terminal stop has a completion time; a PENDING one does not.
ALTER TABLE "delivery_stops"
  ADD CONSTRAINT "delivery_stops_completed_at_matches_status"
  CHECK (
    ("status" = 'PENDING' AND "completedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "completedAt" IS NOT NULL)
  );

-- Sequence within a run starts at 1.
ALTER TABLE "delivery_stops"
  ADD CONSTRAINT "delivery_stops_sequence_positive"
  CHECK ("sequence" >= 1);
