ALTER TABLE "OtherIncome" ADD COLUMN "paymentMethodId" INTEGER;
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
