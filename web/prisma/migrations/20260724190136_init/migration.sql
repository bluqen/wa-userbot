-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connecting',
    "gatewayUrl" TEXT NOT NULL DEFAULT 'http://localhost:4000',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPlugin" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WaSession_userId_idx" ON "WaSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPlugin_sessionId_key_key" ON "SessionPlugin"("sessionId", "key");

-- AddForeignKey
ALTER TABLE "WaSession" ADD CONSTRAINT "WaSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlugin" ADD CONSTRAINT "SessionPlugin_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
