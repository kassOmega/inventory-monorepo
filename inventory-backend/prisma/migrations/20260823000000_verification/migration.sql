-- Account verification (KYC): document uploads, AI review, admin review, and
-- the anti-fraud block. Existing owner accounts and organizations are backfilled
-- to APPROVED so nothing is locked out on deploy; new accounts go through the
-- verification flow.

-- 1) New enums
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FLAGGED', 'BLOCKED');
CREATE TYPE "VerificationAccountType" AS ENUM ('USER', 'BUSINESS');
CREATE TYPE "VerificationDocumentType" AS ENUM ('NATIONAL_ID', 'TRADE_LICENSE', 'TIN_CERTIFICATE');

-- 2) User account verification columns
ALTER TABLE "User" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "User" ADD COLUMN "verificationNote" TEXT;
ALTER TABLE "User" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

-- 3) Organization (business) verification columns
ALTER TABLE "Organization" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Organization" ADD COLUMN "verificationNote" TEXT;
ALTER TABLE "Organization" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

-- 4) Uploaded verification documents (full history, one row per submission)
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "accountType" "VerificationAccountType" NOT NULL,
    "documentType" "VerificationDocumentType" NOT NULL,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "aiResult" JSONB,
    "status" "VerificationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationDocument_accountType_status_idx" ON "VerificationDocument"("accountType", "status");
CREATE INDEX "VerificationDocument_organizationId_idx" ON "VerificationDocument"("organizationId");

ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Backfill existing accounts so current deployments are not locked out
UPDATE "User" SET "verificationStatus" = 'APPROVED' WHERE "isOwnerAccount" = true;
UPDATE "Organization" SET "verificationStatus" = 'APPROVED';
