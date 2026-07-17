-- AlterTable
ALTER TABLE "ProjectMaterial" ADD COLUMN     "taskCategoryId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_taskCategoryId_fkey" FOREIGN KEY ("taskCategoryId") REFERENCES "ProjectTaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
