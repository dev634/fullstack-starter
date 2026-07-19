-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "assignedCompanyId" INTEGER,
ADD COLUMN     "assignedInterimId" INTEGER;

-- AlterTable
ALTER TABLE "ProjectTaskCategory" ADD COLUMN     "assignedCompanyId" INTEGER,
ADD COLUMN     "assignedInterimId" INTEGER;

-- AlterTable
ALTER TABLE "ProjectTaskGroup" ADD COLUMN     "assignedCompanyId" INTEGER,
ADD COLUMN     "assignedInterimId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assignedCompanyId_fkey" FOREIGN KEY ("assignedCompanyId") REFERENCES "SubcontractorCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assignedInterimId_fkey" FOREIGN KEY ("assignedInterimId") REFERENCES "Interim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskGroup" ADD CONSTRAINT "ProjectTaskGroup_assignedCompanyId_fkey" FOREIGN KEY ("assignedCompanyId") REFERENCES "SubcontractorCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskGroup" ADD CONSTRAINT "ProjectTaskGroup_assignedInterimId_fkey" FOREIGN KEY ("assignedInterimId") REFERENCES "Interim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskCategory" ADD CONSTRAINT "ProjectTaskCategory_assignedCompanyId_fkey" FOREIGN KEY ("assignedCompanyId") REFERENCES "SubcontractorCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskCategory" ADD CONSTRAINT "ProjectTaskCategory_assignedInterimId_fkey" FOREIGN KEY ("assignedInterimId") REFERENCES "Interim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
