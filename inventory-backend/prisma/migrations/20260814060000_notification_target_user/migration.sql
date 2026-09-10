-- Per-user notifications (e.g. notify the waiter who created an order).
ALTER TABLE "Notification" ADD COLUMN "targetUserId" INTEGER;
