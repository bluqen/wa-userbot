-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "contactJid" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sessionId_contactJid_key" ON "Lead"("sessionId", "contactJid");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
