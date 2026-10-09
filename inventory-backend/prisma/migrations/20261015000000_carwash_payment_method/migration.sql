-- Record the payment method money was received in when a car-wash wash is
-- settled (Paid). Nullable: settled rows created before this have no method and
-- appear under "Unspecified" in the payment-method report.
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "paymentMethodId" INTEGER;

CREATE INDEX IF NOT EXISTS "CarWash_paymentMethodId_idx" ON "CarWash"("paymentMethodId");

ALTER TABLE "CarWash"
  ADD CONSTRAINT "CarWash_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
