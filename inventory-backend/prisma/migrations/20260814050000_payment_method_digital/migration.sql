-- Distinguish digital payment methods (Telebirr/CBE/Card) from cash.
ALTER TABLE "PaymentMethod" ADD COLUMN "isDigital" BOOLEAN NOT NULL DEFAULT false;
