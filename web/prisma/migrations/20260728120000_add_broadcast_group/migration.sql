-- CreateTable
CREATE TABLE "BroadcastGroup" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastGroup_sessionId_name_key" ON "BroadcastGroup"("sessionId", "name");

-- AddForeignKey
ALTER TABLE "BroadcastGroup" ADD CONSTRAINT "BroadcastGroup_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
