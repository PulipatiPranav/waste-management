-- Adds the marketplace wallet transaction types (Phase 8) in their OWN migration.
--
-- Postgres will not let a newly-added enum value be *referenced* in the same transaction
-- that adds it ("unsafe use of new value"). The Phase 8 migration needs to reference
-- 'ORDER_PAYMENT' in the predicate of a partial unique index, so the value must be committed
-- first, here, in a transaction that only adds it and never uses it.

ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'ORDER_PAYMENT';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'ORDER_REFUND';
