-- Multi-unit guest ordering: remember the variant and unit the guest picked,
-- plus a display snapshot of the unit name, so the accepted order can be
-- converted into a Sale with the same unit and price.
ALTER TABLE "GuestOrderItem"
  ADD COLUMN "variantId" INTEGER,
  ADD COLUMN "unitId" INTEGER,
  ADD COLUMN "unitNameSnapshot" TEXT;

CREATE INDEX "GuestOrderItem_variantId_idx" ON "GuestOrderItem"("variantId");
CREATE INDEX "GuestOrderItem_unitId_idx" ON "GuestOrderItem"("unitId");
