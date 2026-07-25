-- CreateTable
CREATE TABLE "Sticker" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimetype" TEXT NOT NULL DEFAULT 'image/webp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sticker_sessionId_tag_key" ON "Sticker"("sessionId", "tag");

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
