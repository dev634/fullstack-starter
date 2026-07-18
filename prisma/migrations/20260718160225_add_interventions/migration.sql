-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('PLANIFIEE', 'FAITE', 'ANNULEE');

-- CreateTable
CREATE TABLE "Intervention" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "technician" TEXT,
    "status" "InterventionStatus" NOT NULL DEFAULT 'PLANIFIEE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
