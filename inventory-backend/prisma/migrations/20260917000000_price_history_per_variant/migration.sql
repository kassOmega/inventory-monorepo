-- Per-variant price history.
--
-- A price change can target one variant (restock/receive/purchase lines carry a
-- per-variant cost), and the history page shows the product's own row as the
-- main row (the average across variants) with the per-variant rows underneath.
-- `batchRef` groups every row written by ONE user action so that grouping is
-- deterministic instead of relying on timestamp proximity.
ALTER TABLE "PriceHistory" ADD COLUMN "variantId" INTEGER;
ALTER TABLE "PriceHistory" ADD COLUMN "batchRef" TEXT;
ALTER TABLE "PriceHistory" ADD COLUMN "source" TEXT;

ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PriceHistory_productId_updatedAt_idx" ON "PriceHistory"("productId", "updatedAt");
CREATE INDEX "PriceHistory_variantId_idx" ON "PriceHistory"("variantId");
CREATE INDEX "PriceHistory_batchRef_idx" ON "PriceHistory"("batchRef");
