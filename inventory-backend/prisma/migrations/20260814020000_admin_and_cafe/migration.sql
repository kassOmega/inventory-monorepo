-- Add the CAFE business type and the platform-admin flag on User.
ALTER TYPE "BusinessType" ADD VALUE 'CAFE';
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
