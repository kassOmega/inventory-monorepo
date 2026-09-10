-- Payment methods: add a descriptive account/destination for each bank.
ALTER TABLE "PaymentMethod" ADD COLUMN "account" TEXT;
