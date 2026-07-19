-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: seed one primary Contact per existing client from its own
-- person fields. Additive — no client data is removed here (the Client-level
-- person columns are dropped in a later migration, once reads use contacts).
INSERT INTO "Contact" ("clientId", "firstName", "lastName", "email", "phone", "isPrimary", "createdAt")
SELECT "id", "firstName", "lastName", "email", "phone", true, CURRENT_TIMESTAMP
FROM "Client";
