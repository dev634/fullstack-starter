-- AlterTable
ALTER TABLE "ProjectMaterial" ADD COLUMN     "requiredQuantity" DOUBLE PRECISION,
ADD COLUMN     "taskId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
