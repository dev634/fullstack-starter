-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "Client_companyName_trgm_idx" ON "Client" USING GIN ("companyName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_email_trgm_idx" ON "Client" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
