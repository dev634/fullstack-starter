-- DropIndex
DROP INDEX "ReservePlanFolder_projectId_idx";

-- AlterTable
ALTER TABLE "ReservePlanFolder" ADD COLUMN     "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "ReservePlanFolder_projectId_parentId_idx" ON "ReservePlanFolder"("projectId", "parentId");

-- CreateIndex
CREATE INDEX "ReservePlanFolder_parentId_idx" ON "ReservePlanFolder"("parentId");

-- AddForeignKey
ALTER TABLE "ReservePlanFolder" ADD CONSTRAINT "ReservePlanFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ReservePlanFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

