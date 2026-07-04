-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'CLIENT', 'INACTIVE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'PROSPECT',
ADD COLUMN     "website" TEXT;
