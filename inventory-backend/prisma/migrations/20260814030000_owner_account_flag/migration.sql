-- Distinguish owner accounts (managed by the system admin) from staff
-- (added and managed by owners within their business).
ALTER TABLE "User" ADD COLUMN "isOwnerAccount" BOOLEAN NOT NULL DEFAULT false;
