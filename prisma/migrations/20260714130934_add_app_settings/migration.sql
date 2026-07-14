-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appName" TEXT NOT NULL DEFAULT 'Fullstack Starter',
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "accentColor" TEXT NOT NULL DEFAULT '#8b5cf6',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the one singleton row so getSettings() never has to handle "missing".
INSERT INTO "AppSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
