-- CreateTable
CREATE TABLE "JobFunction" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFunction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobFunction_name_key" ON "JobFunction"("name");

-- Seed the default job functions (idempotent — safe to re-run / on any env).
INSERT INTO "JobFunction" ("name") VALUES
    ('Manœuvre'),
    ('Électricien'),
    ('Structuriste'),
    ('Chef de chantier'),
    ('Conducteur de travaux'),
    ('Chef de projet'),
    ('Responsable d''agence'),
    ('Responsable de secteur')
ON CONFLICT ("name") DO NOTHING;
