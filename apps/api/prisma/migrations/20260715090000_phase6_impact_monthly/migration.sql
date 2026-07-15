-- Sustainability impact cache (Phase 6). A materialised, nightly-refreshed scan of
-- confirmed-recycled pickup items, keyed per user / month / paper type. Caches the raw
-- measured GRAMS, not the derived impact, so a conversion-factor update reflects immediately.

CREATE TABLE "impact_monthly" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "paperType" "PaperType" NOT NULL,
    "recycledGrams" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "impact_monthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "impact_monthly_userId_yearMonth_paperType_key"
  ON "impact_monthly"("userId", "yearMonth", "paperType");
CREATE INDEX "impact_monthly_userId_idx" ON "impact_monthly"("userId");
CREATE INDEX "impact_monthly_yearMonth_idx" ON "impact_monthly"("yearMonth");

ALTER TABLE "impact_monthly"
  ADD CONSTRAINT "impact_monthly_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Weight is never negative, and the month is a real YYYY-MM.
ALTER TABLE "impact_monthly"
  ADD CONSTRAINT "impact_monthly_grams_non_negative" CHECK ("recycledGrams" >= 0);
ALTER TABLE "impact_monthly"
  ADD CONSTRAINT "impact_monthly_yearmonth_format"
  CHECK ("yearMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
