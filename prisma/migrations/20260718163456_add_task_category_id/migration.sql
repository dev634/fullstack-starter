-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "categoryId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectTaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
