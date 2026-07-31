-- AlterTable
ALTER TABLE "ReservePlan" ADD COLUMN     "folderId" INTEGER;

-- CreateTable
CREATE TABLE "ReservePlanFolder" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservePlanFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservePlanFolder_projectId_idx" ON "ReservePlanFolder"("projectId");

-- CreateIndex
CREATE INDEX "ReservePlan_folderId_idx" ON "ReservePlan"("folderId");

-- AddForeignKey
ALTER TABLE "ReservePlanFolder" ADD CONSTRAINT "ReservePlanFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservePlan" ADD CONSTRAINT "ReservePlan_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ReservePlanFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

