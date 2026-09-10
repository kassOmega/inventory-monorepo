-- Public AI onboarding assistant guest quota (5 free chats / device / UTC day).
CREATE TABLE "AiAssistGuest" (
  "id" SERIAL NOT NULL,
  "guestId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiAssistGuest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAssistGuest_guestId_date_key" ON "AiAssistGuest"("guestId", "date");
CREATE INDEX "AiAssistGuest_guestId_idx" ON "AiAssistGuest"("guestId");