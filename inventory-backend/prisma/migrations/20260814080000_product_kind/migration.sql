-- Hospitality inventory: classify products as goods / beverages / ingredients.
CREATE TYPE "ProductKind" AS ENUM ('GOODS', 'BEVERAGE', 'INGREDIENT');
ALTER TABLE "Product" ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'GOODS';
