-- Contact: replace the free-text "role" with a managed job function (FK).
-- Existing free-text values are dropped (product decision: single source of
-- truth is the managed JobFunction list).
ALTER TABLE "Contact" DROP COLUMN "role";
ALTER TABLE "Contact" ADD COLUMN "jobFunctionId" INTEGER;
ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_jobFunctionId_fkey"
  FOREIGN KEY ("jobFunctionId") REFERENCES "JobFunction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contact_jobFunctionId_idx" ON "Contact"("jobFunctionId");

-- User: add an optional managed job function.
ALTER TABLE "User" ADD COLUMN "jobFunctionId" INTEGER;
ALTER TABLE "User"
  ADD CONSTRAINT "User_jobFunctionId_fkey"
  FOREIGN KEY ("jobFunctionId") REFERENCES "JobFunction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_jobFunctionId_idx" ON "User"("jobFunctionId");
