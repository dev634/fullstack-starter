-- CreateTable
CREATE TABLE "SubcontractorCompany" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorPerson" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorPerson_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SubcontractorCompany" ADD CONSTRAINT "SubcontractorCompany_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorPerson" ADD CONSTRAINT "SubcontractorPerson_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SubcontractorCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
