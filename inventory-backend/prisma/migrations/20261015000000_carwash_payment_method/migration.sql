-- Record the payment method money was received in when a car-wash wash is
-- settled (Paid). Nullable: settled rows created before this have no method and
-- appear under "Unspecified" in the payment-method report.
--
-- Every statement is idempotent: legacy `db push` databases already have this
-- column + FK from `prisma db push` (which runs before this file), so re-adding
-- the constraint must not abort the entrypoint.
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "paymentMethodId" INTEGER;

CREATE INDEX IF NOT EXISTS "CarWash_paymentMethodId_idx" ON "CarWash"("paymentMethodId");

-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so guard with a catalog check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CarWash_paymentMethodId_fkey'
  ) THEN
    ALTER TABLE "CarWash"
      ADD CONSTRAINT "CarWash_paymentMethodId_fkey"
      FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
