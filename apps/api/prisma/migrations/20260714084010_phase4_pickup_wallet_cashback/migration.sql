-- CreateEnum
CREATE TYPE "PaperType" AS ENUM ('NEWSPAPER', 'MAGAZINE', 'OFFICE_PAPER', 'CARDBOARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('PICKUP_CASHBACK', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTxnDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_card_items" (
    "id" UUID NOT NULL,
    "rateCardId" UUID NOT NULL,
    "paperType" "PaperType" NOT NULL,
    "ratePerKgPaise" INTEGER NOT NULL,

    CONSTRAINT "rate_card_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "windowStartHour" INTEGER NOT NULL,
    "windowEndHour" INTEGER NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "qrToken" TEXT NOT NULL,
    "runId" UUID,
    "assignedPartnerId" UUID,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_items" (
    "id" UUID NOT NULL,
    "pickupId" UUID NOT NULL,
    "paperType" "PaperType" NOT NULL,
    "weightGrams" INTEGER NOT NULL,
    "ratePerKgPaiseAtPickup" INTEGER NOT NULL,
    "rateCardId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "balancePaise" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "direction" "WalletTxnDirection" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "balanceAfterPaise" BIGINT NOT NULL,
    "pickupId" UUID,
    "withdrawalId" UUID,
    "note" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "bankAccountLast4" TEXT NOT NULL,
    "bankIfsc" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_items_rateCardId_paperType_key" ON "rate_card_items"("rateCardId", "paperType");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_requests_qrToken_key" ON "pickup_requests"("qrToken");

-- CreateIndex
CREATE INDEX "pickup_requests_userId_idx" ON "pickup_requests"("userId");

-- CreateIndex
CREATE INDEX "pickup_requests_scheduledDate_status_idx" ON "pickup_requests"("scheduledDate", "status");

-- CreateIndex
CREATE INDEX "pickup_requests_runId_idx" ON "pickup_requests"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_items_pickupId_paperType_key" ON "pickup_items"("pickupId", "paperType");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_pickupId_key" ON "wallet_transactions"("pickupId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_idx" ON "wallet_transactions"("type");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_idx" ON "withdrawal_requests"("userId");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_createdAt_idx" ON "withdrawal_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_userId_key_endpoint_key" ON "idempotency_keys"("userId", "key", "endpoint");

-- AddForeignKey
ALTER TABLE "rate_card_items" ADD CONSTRAINT "rate_card_items_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "rate_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_runId_fkey" FOREIGN KEY ("runId") REFERENCES "daily_delivery_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_requests" ADD CONSTRAINT "pickup_requests_assignedPartnerId_fkey" FOREIGN KEY ("assignedPartnerId") REFERENCES "delivery_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_items" ADD CONSTRAINT "pickup_items_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "pickup_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_items" ADD CONSTRAINT "pickup_items_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "rate_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "pickup_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawal_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- THE MONEY INVARIANTS.
--
-- Every rule below is ALSO enforced in the domain layer. It is here as well
-- because application-only enforcement is one bad write path — a script, a
-- future migration, an ORM shortcut — away from being untrue, and the thing
-- being protected is customers' money.
-- ===========================================================================

-- --- The ledger is APPEND-ONLY ---------------------------------------------
--
-- Not a convention. Not a code-review rule. The database refuses.
--
-- A financial ledger whose rows can change after the fact cannot be used to settle a
-- dispute, reconcile a balance, or answer an auditor — and "we agreed not to update it"
-- is not a control. Corrections are a NEW row (see WalletTxnType.ADJUSTMENT), which is
-- what double-entry bookkeeping has done for six hundred years.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'wallet_transactions is append-only: % on a ledger row is forbidden. Post a correcting ADJUSTMENT entry instead.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_transactions_no_update
  BEFORE UPDATE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER wallet_transactions_no_delete
  BEFORE DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- --- Amounts are positive; direction carries the sign ----------------------
--
-- A signed amount lets "-500 CREDIT" exist, and then two readers disagree about what it
-- means. Amount is magnitude, direction is meaning.
ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_amount_positive"
  CHECK ("amountPaise" > 0);

-- A balance can be zero but never negative — not even transiently, mid-ledger.
ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_balance_after_non_negative"
  CHECK ("balanceAfterPaise" >= 0);

-- --- A wallet can never go negative ----------------------------------------
--
-- This is the constraint that turns an overdraw from "a customer who mysteriously owes
-- us money" into "the transaction aborted". It is also what makes the atomicity test
-- possible: a failing DEBIT rolls the whole $transaction back.
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_balance_non_negative"
  CHECK ("balancePaise" >= 0);

-- --- Weight and money are non-negative -------------------------------------
ALTER TABLE "pickup_items"
  ADD CONSTRAINT "pickup_items_weight_positive"
  CHECK ("weightGrams" > 0);

ALTER TABLE "pickup_items"
  ADD CONSTRAINT "pickup_items_rate_non_negative"
  CHECK ("ratePerKgPaiseAtPickup" >= 0);

ALTER TABLE "pickup_items"
  ADD CONSTRAINT "pickup_items_amount_non_negative"
  CHECK ("amountPaise" >= 0);

ALTER TABLE "rate_card_items"
  ADD CONSTRAINT "rate_card_items_rate_non_negative"
  CHECK ("ratePerKgPaise" >= 0);

ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_amount_positive"
  CHECK ("amountPaise" > 0);

-- --- Exactly one active rate card ------------------------------------------
--
-- Two active cards means the cashback a customer receives depends on which row the query
-- planner happened to return first.
CREATE UNIQUE INDEX "rate_cards_only_one_active"
  ON "rate_cards" (("isActive"))
  WHERE "isActive" = true;

-- --- Pickup windows are sane -----------------------------------------------
ALTER TABLE "pickup_requests"
  ADD CONSTRAINT "pickup_requests_window_ordered"
  CHECK (
    "windowStartHour" >= 0 AND "windowEndHour" <= 24
    AND "windowStartHour" < "windowEndHour"
  );

-- --- Terminal states carry their timestamps --------------------------------
ALTER TABLE "pickup_requests"
  ADD CONSTRAINT "pickup_requests_timestamps_match_status"
  CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
    OR ("status" IN ('REQUESTED', 'ASSIGNED') AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
  );
