-- i18n foundation: tenant default UI language + user language preference +
-- localized JSON content columns for user-generated entities.

-- 1) Language preference columns
ALTER TABLE "Organization" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "User" ADD COLUMN "preferredLanguage" TEXT;

-- 2) Localized content columns ({ en, am } JSON, optional per language)
ALTER TABLE "Category" ADD COLUMN "nameI18n" JSONB;
ALTER TABLE "Category" ADD COLUMN "descriptionI18n" JSONB;

ALTER TABLE "Product" ADD COLUMN "brandI18n" JSONB;
ALTER TABLE "Product" ADD COLUMN "baseNameI18n" JSONB;

ALTER TABLE "Unit" ADD COLUMN "nameI18n" JSONB;

ALTER TABLE "Location" ADD COLUMN "nameI18n" JSONB;

ALTER TABLE "PaymentMethod" ADD COLUMN "nameI18n" JSONB;

ALTER TABLE "RestaurantStation" ADD COLUMN "nameI18n" JSONB;
ALTER TABLE "RestaurantStation" ADD COLUMN "roleNameI18n" JSONB;

ALTER TABLE "MenuCategory" ADD COLUMN "nameI18n" JSONB;

ALTER TABLE "MenuItem" ADD COLUMN "nameI18n" JSONB;
ALTER TABLE "MenuItem" ADD COLUMN "descriptionI18n" JSONB;
