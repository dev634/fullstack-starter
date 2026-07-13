-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectActivityLog" (
    "id" SERIAL NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "projectId" INTEGER,
    "projectName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivityLog_pkey" PRIMARY KEY ("id")
);
