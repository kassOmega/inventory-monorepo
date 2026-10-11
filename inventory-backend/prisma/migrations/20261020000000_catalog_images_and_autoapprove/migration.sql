-- Catalogue images (product/variant/room-type/service-item) + per-entry
-- auto-approve toggle for public QR guest orders. Idempotent.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "RoomType" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "ServiceItem" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- Guest ordering: skip the manual approval gate per entry (owner-controlled).
ALTER TABLE "PublicEntry" ADD COLUMN IF NOT EXISTS "autoApprove" BOOLEAN NOT NULL DEFAULT false;
