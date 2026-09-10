-- Give credit payments a non-guessable publicId so the credits module can be
-- addressed by UUID (update/delete) instead of the autoincrement id.
-- Column is added with a DB-side default so existing rows are backfilled
-- atomically without touching the application code path.

ALTER TABLE "CreditPayment"
  ADD COLUMN "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "CreditPayment_publicId_key" ON "CreditPayment"("publicId");
