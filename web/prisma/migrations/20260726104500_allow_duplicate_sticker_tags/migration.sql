-- DropIndex
DROP INDEX "Sticker_sessionId_tag_key";

-- CreateIndex
CREATE INDEX "Sticker_sessionId_tag_idx" ON "Sticker"("sessionId", "tag");
