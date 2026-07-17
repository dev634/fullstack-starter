-- AlterTable
ALTER TABLE "ProjectTaskGroup" ADD COLUMN     "categoryId" INTEGER;

-- CreateTable
CREATE TABLE "ProjectTaskCategory" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTaskCategory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProjectTaskGroup" ADD CONSTRAINT "ProjectTaskGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectTaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskCategory" ADD CONSTRAINT "ProjectTaskCategory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
