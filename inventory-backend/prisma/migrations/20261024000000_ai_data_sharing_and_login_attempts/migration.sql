-- AlterTable
-- IF NOT EXISTS: this migration is re-run by the entrypoint's self-heal on a
-- database whose schema was already synced by `prisma db push`, where the
-- column/table already exist. Without it, the replay fails with 42P07/42701.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "aiDataSharingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoginAttempt" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoginAttempt_key_key" ON "LoginAttempt"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoginAttempt_blockedUntil_idx" ON "LoginAttempt"("blockedUntil");
