-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'RESTORED', 'PERMANENTLY_DELETED', 'IMPORTED');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "clientId" INTEGER,
    "clientName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
