-- Merge the three hospitality verticals (HOTEL, RESTAURANT, CAFE) into a single
-- HOSPITALITY business type. The data migration happens inside the ALTER COLUMN
-- USING clause so the whole change stays in one statement (avoiding the
-- "ALTER TYPE ... ADD VALUE" transaction restriction).

-- 1) Build the replacement enum type.
CREATE TYPE "BusinessType_new" AS ENUM ('ELECTRICAL', 'CAR_PARTS', 'GENERAL_GOODS', 'BOUTIQUE', 'CHILDREN_ACCESSORIES', 'HOSPITALITY');

-- 2) Re-type the column, mapping the old hospitality values onto HOSPITALITY.
ALTER TABLE "Organization" ALTER COLUMN "businessType" DROP DEFAULT;

ALTER TABLE "Organization"
  ALTER COLUMN "businessType" TYPE "BusinessType_new"
  USING (
    CASE "businessType"::text
      WHEN 'HOTEL' THEN 'HOSPITALITY'
      WHEN 'RESTAURANT' THEN 'HOSPITALITY'
      WHEN 'CAFE' THEN 'HOSPITALITY'
      ELSE "businessType"::text
    END
  )::"BusinessType_new";

ALTER TABLE "Organization" ALTER COLUMN "businessType" SET DEFAULT 'ELECTRICAL';

-- 3) Swap the enum types.
DROP TYPE "BusinessType";
ALTER TYPE "BusinessType_new" RENAME TO "BusinessType";
