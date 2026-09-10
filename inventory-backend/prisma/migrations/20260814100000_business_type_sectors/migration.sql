-- Consolidate business types into three sectors: Retail & Distribution,
-- Hospitality & Service, and Manufacturing & Production.
CREATE TYPE "BusinessType_new" AS ENUM ('RETAIL', 'HOSPITALITY', 'MANUFACTURING');

ALTER TABLE "Organization" ALTER COLUMN "businessType" DROP DEFAULT;

ALTER TABLE "Organization"
  ALTER COLUMN "businessType" TYPE "BusinessType_new"
  USING (
    CASE "businessType"::text
      WHEN 'ELECTRICAL' THEN 'RETAIL'
      WHEN 'CAR_PARTS' THEN 'RETAIL'
      WHEN 'GENERAL_GOODS' THEN 'RETAIL'
      WHEN 'BOUTIQUE' THEN 'RETAIL'
      WHEN 'CHILDREN_ACCESSORIES' THEN 'RETAIL'
      ELSE "businessType"::text
    END
  )::"BusinessType_new";

ALTER TABLE "Organization" ALTER COLUMN "businessType" SET DEFAULT 'RETAIL';

DROP TYPE "BusinessType";
ALTER TYPE "BusinessType_new" RENAME TO "BusinessType";
