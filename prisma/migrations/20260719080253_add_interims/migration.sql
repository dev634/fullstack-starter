-- CreateTable
CREATE TABLE "Interim" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "agency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interim_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Interim" ADD CONSTRAINT "Interim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
