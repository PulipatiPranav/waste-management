-- CreateEnum
CREATE TYPE "RecyclingPartnerStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'READY', 'DISPATCHED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('IN_TRANSIT', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "pickup_items" ADD COLUMN     "batchId" UUID;

-- CreateTable
CREATE TABLE "recycling_partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecyclingPartnerStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedPaperTypes" "PaperType"[],
    "dailyCapacityGrams" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "gstin" TEXT,
    "pollutionBoardId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recycling_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_batches" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "zoneId" UUID NOT NULL,
    "paperType" "PaperType" NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "collectedWeightGrams" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_dispatches" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transporterName" TEXT NOT NULL,
    "transporterVehicleNo" TEXT NOT NULL,
    "transporterContact" TEXT NOT NULL,
    "confirmedWeightGrams" INTEGER,
    "discrepancyGrams" INTEGER,
    "discrepancyBps" INTEGER,
    "discrepancyFlagged" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" UUID,
    "rejectionReason" TEXT,
    "weighbridgeSlipRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recycling_partners_name_key" ON "recycling_partners"("name");

-- CreateIndex
CREATE INDEX "recycling_partners_status_idx" ON "recycling_partners"("status");

-- CreateIndex
CREATE INDEX "recycling_partners_city_idx" ON "recycling_partners"("city");

-- CreateIndex
CREATE UNIQUE INDEX "collection_batches_reference_key" ON "collection_batches"("reference");

-- CreateIndex
CREATE INDEX "collection_batches_zoneId_paperType_status_idx" ON "collection_batches"("zoneId", "paperType", "status");

-- CreateIndex
CREATE INDEX "collection_batches_status_idx" ON "collection_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "batch_dispatches_batchId_key" ON "batch_dispatches"("batchId");

-- CreateIndex
CREATE INDEX "batch_dispatches_partnerId_dispatchedAt_idx" ON "batch_dispatches"("partnerId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "batch_dispatches_status_idx" ON "batch_dispatches"("status");

-- CreateIndex
CREATE INDEX "batch_dispatches_discrepancyFlagged_idx" ON "batch_dispatches"("discrepancyFlagged");

-- CreateIndex
CREATE INDEX "pickup_items_batchId_idx" ON "pickup_items"("batchId");

-- AddForeignKey
ALTER TABLE "pickup_items" ADD CONSTRAINT "pickup_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "collection_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_dispatches" ADD CONSTRAINT "batch_dispatches_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "collection_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_dispatches" ADD CONSTRAINT "batch_dispatches_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "recycling_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Chain-of-custody invariants.
-- ---------------------------------------------------------------------------

-- At most ONE open batch per (zone, paper type).
--
-- Two open batches for the same paper in the same zone would split a load arbitrarily,
-- depending on which row a query happened to return first — and the chain of custody would
-- then depend on query-planner luck, which is exactly what it must never do.
CREATE UNIQUE INDEX "collection_batches_one_open_per_zone_and_type"
  ON "collection_batches" ("zoneId", "paperType")
  WHERE "status" = 'OPEN';

-- Weights are never negative.
ALTER TABLE "collection_batches"
  ADD CONSTRAINT "collection_batches_weight_non_negative"
  CHECK ("collectedWeightGrams" >= 0 AND "itemCount" >= 0);

ALTER TABLE "batch_dispatches"
  ADD CONSTRAINT "batch_dispatches_confirmed_weight_non_negative"
  CHECK ("confirmedWeightGrams" IS NULL OR "confirmedWeightGrams" >= 0);

-- A confirmed dispatch has a weight and a timestamp; an in-transit one has neither.
--
-- Without this, "CONFIRMED with no weighbridge reading" is representable — and that row is
-- indistinguishable from a real confirmation in every report Phase 6 will build on it.
ALTER TABLE "batch_dispatches"
  ADD CONSTRAINT "batch_dispatches_confirmation_is_complete"
  CHECK (
    ("status" = 'CONFIRMED'
      AND "confirmedWeightGrams" IS NOT NULL
      AND "confirmedAt" IS NOT NULL
      AND "discrepancyGrams" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "rejectionReason" IS NOT NULL)
    OR ("status" = 'IN_TRANSIT'
      AND "confirmedWeightGrams" IS NULL
      AND "confirmedAt" IS NULL)
  );

-- A mill must accept at least one paper type, or it can never receive anything and its
-- presence in the partner list is a trap for whoever tries to dispatch to it.
ALTER TABLE "recycling_partners"
  ADD CONSTRAINT "recycling_partners_accepts_something"
  CHECK (array_length("acceptedPaperTypes", 1) >= 1);

ALTER TABLE "recycling_partners"
  ADD CONSTRAINT "recycling_partners_capacity_positive"
  CHECK ("dailyCapacityGrams" > 0);
