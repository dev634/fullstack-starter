-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "projectSectionOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
