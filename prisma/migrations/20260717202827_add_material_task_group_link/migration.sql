-- AlterTable
ALTER TABLE "ProjectMaterial" ADD COLUMN     "taskGroupId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_taskGroupId_fkey" FOREIGN KEY ("taskGroupId") REFERENCES "ProjectTaskGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
