-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('APARTMENT', 'BUSINESS');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('FLAT_MONTHLY', 'PER_KG');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID');

-- AlterTable
ALTER TABLE "pickup_requests" ADD COLUMN     "apartmentId" UUID,
ADD COLUMN     "businessId" UUID;

-- CreateTable
CREATE TABLE "org_members" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgKind" "OrgKind" NOT NULL,
    "orgRole" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "apartmentId" UUID,
    "businessId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_contracts" (
    "id" UUID NOT NULL,
    "orgKind" "OrgKind" NOT NULL,
    "apartmentId" UUID,
    "businessId" UUID,
    "type" "ContractType" NOT NULL,
    "flatAmountPaise" INTEGER,
    "perKgRatePaise" INTEGER,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_invoices" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "orgKind" "OrgKind" NOT NULL,
    "apartmentId" UUID,
    "businessId" UUID,
    "periodLabel" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "flatAmountPaise" INTEGER,
    "perKgRatePaise" INTEGER,
    "recycledGrams" INTEGER NOT NULL DEFAULT 0,
    "amountPaise" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_members_apartmentId_idx" ON "org_members"("apartmentId");

-- CreateIndex
CREATE INDEX "org_members_businessId_idx" ON "org_members"("businessId");

-- CreateIndex
CREATE INDEX "org_members_userId_idx" ON "org_members"("userId");

-- CreateIndex
CREATE INDEX "org_contracts_apartmentId_idx" ON "org_contracts"("apartmentId");

-- CreateIndex
CREATE INDEX "org_contracts_businessId_idx" ON "org_contracts"("businessId");

-- CreateIndex
CREATE INDEX "org_contracts_status_idx" ON "org_contracts"("status");

-- CreateIndex
CREATE INDEX "org_invoices_apartmentId_idx" ON "org_invoices"("apartmentId");

-- CreateIndex
CREATE INDEX "org_invoices_businessId_idx" ON "org_invoices"("businessId");

-- CreateIndex
CREATE INDEX "org_invoices_status_idx" ON "org_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "org_invoices_contractId_periodLabel_key" ON "org_invoices"("contractId", "periodLabel");

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contracts" ADD CONSTRAINT "org_contracts_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_contracts" ADD CONSTRAINT "org_contracts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invoices" ADD CONSTRAINT "org_invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "org_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Org invariants Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- A membership, contract, invoice and org-attributed pickup each belong to EXACTLY ONE org.
-- The (apartmentId, businessId) pair must have exactly one set, matching orgKind. A row with
-- neither is orphaned; a row with both is a tenant-isolation hole waiting to be read the
-- wrong way.
ALTER TABLE "org_members"
  ADD CONSTRAINT "org_members_exactly_one_org"
  CHECK (("apartmentId" IS NOT NULL)::int + ("businessId" IS NOT NULL)::int = 1);

ALTER TABLE "org_contracts"
  ADD CONSTRAINT "org_contracts_exactly_one_org"
  CHECK (("apartmentId" IS NOT NULL)::int + ("businessId" IS NOT NULL)::int = 1);

-- A pickup is EITHER individual (no org) OR attributed to exactly one org.
ALTER TABLE "pickup_requests"
  ADD CONSTRAINT "pickup_requests_at_most_one_org"
  CHECK (("apartmentId" IS NOT NULL)::int + ("businessId" IS NOT NULL)::int <= 1);

-- A user belongs to a given org at most once. Two partial unique indexes rather than one
-- @@unique across nullable columns, which would treat every (user, NULL-apartment) row as
-- distinct and let a user join the same business twice.
CREATE UNIQUE INDEX "org_members_user_apartment_unique"
  ON "org_members" ("userId", "apartmentId") WHERE "apartmentId" IS NOT NULL;
CREATE UNIQUE INDEX "org_members_user_business_unique"
  ON "org_members" ("userId", "businessId") WHERE "businessId" IS NOT NULL;

-- At most ONE admin per org — a single accountable owner. Two admins is a governance
-- ambiguity ("who authorised this contract?"); the model keeps it to one until a real
-- multi-admin permission scheme is designed.
CREATE UNIQUE INDEX "org_members_one_apartment_admin"
  ON "org_members" ("apartmentId") WHERE "orgRole" = 'ADMIN' AND "apartmentId" IS NOT NULL;
CREATE UNIQUE INDEX "org_members_one_business_admin"
  ON "org_members" ("businessId") WHERE "orgRole" = 'ADMIN' AND "businessId" IS NOT NULL;

-- Contract terms match their type: a FLAT_MONTHLY contract has a flat amount and no per-kg
-- rate; a PER_KG contract the reverse. A contract with neither cannot produce an invoice.
ALTER TABLE "org_contracts"
  ADD CONSTRAINT "org_contracts_terms_match_type"
  CHECK (
    ("type" = 'FLAT_MONTHLY' AND "flatAmountPaise" IS NOT NULL AND "flatAmountPaise" >= 0 AND "perKgRatePaise" IS NULL)
    OR ("type" = 'PER_KG' AND "perKgRatePaise" IS NOT NULL AND "perKgRatePaise" >= 0 AND "flatAmountPaise" IS NULL)
  );

-- Money and weight are never negative.
ALTER TABLE "org_invoices"
  ADD CONSTRAINT "org_invoices_amounts_non_negative"
  CHECK ("amountPaise" >= 0 AND "recycledGrams" >= 0);

-- An invoice period is ordered.
ALTER TABLE "org_invoices"
  ADD CONSTRAINT "org_invoices_period_ordered"
  CHECK ("periodEnd" >= "periodStart");
