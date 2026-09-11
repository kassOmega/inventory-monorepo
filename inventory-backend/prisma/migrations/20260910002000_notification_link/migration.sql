-- Optional in-app deep link for a notification (e.g. "/dashboard/cashier").
-- Nullable, so existing rows need no backfill; older clients ignore it.

ALTER TABLE "Notification"
  ADD COLUMN "link" TEXT;
