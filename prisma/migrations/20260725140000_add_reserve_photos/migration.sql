-- CreateTable
CREATE TABLE "ReservePhoto" (
    "id" SERIAL NOT NULL,
    "reserveId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservePhoto_reserveId_idx" ON "ReservePhoto"("reserveId");

-- AddForeignKey
ALTER TABLE "ReservePhoto" ADD CONSTRAINT "ReservePhoto_reserveId_fkey" FOREIGN KEY ("reserveId") REFERENCES "Reserve"("id") ON DELETE CASCADE ON UPDATE CASCADE;
