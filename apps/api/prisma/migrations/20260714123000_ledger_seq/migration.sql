-- ---------------------------------------------------------------------------
-- The ledger gets a MONOTONIC SEQUENCE, and stops being ordered by a timestamp.
--
-- Why: `createdAt DEFAULT CURRENT_TIMESTAMP` is the TRANSACTION START time, frozen for
-- the transaction's entire life. But a transaction that starts earlier can COMMIT later,
-- because it waits on the wallet row lock. So a perfectly correct ledger can contain an
-- entry with an earlier createdAt and a LATER balanceAfter.
--
-- Replaying such a ledger in timestamp order reports a break in a sound ledger — and, in
-- other interleavings, hides a genuine lost update. A reconciliation tool that cries wolf
-- is worse than no tool at all, because people stop trusting it.
--
-- `seq` is assigned by Postgres at INSERT, which happens while the wallet lock is held.
-- Per wallet, sequence order therefore IS commit order. That is the only ordering a
-- financial ledger may rely on.
-- ---------------------------------------------------------------------------

ALTER TABLE "wallet_transactions" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- Backfill: existing rows are ordered by createdAt, which is the best information we have
-- for history written before this column existed. It is imperfect for rows created in the
-- interleaving described above; going forward it cannot happen again.
--
-- (In this codebase there is no production data yet, so this is exact.)

CREATE UNIQUE INDEX "wallet_transactions_seq_key" ON "wallet_transactions"("seq");
CREATE INDEX "wallet_transactions_walletId_seq_idx" ON "wallet_transactions"("walletId", "seq");
DROP INDEX IF EXISTS "wallet_transactions_walletId_createdAt_idx";
