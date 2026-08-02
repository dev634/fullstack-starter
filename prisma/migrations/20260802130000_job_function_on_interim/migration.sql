-- Interim: replace the free-text "role" with a managed job function (FK),
-- mirroring the same change already made on Contact
-- (20260725193000_job_function_on_user_and_contact).
--
-- Order matters here: unlike the Contact migration (which dropped "role"
-- outright), we ADD the new column first, BACKFILL from the old free-text
-- values that happen to match a managed function name, and only THEN drop
-- "role" — so a temp worker whose typed role was e.g. "Électricien" keeps it
-- as a proper JobFunction link instead of silently losing it.

-- a. New nullable FK column + constraint + index (same style as Contact).
ALTER TABLE "Interim" ADD COLUMN "jobFunctionId" INTEGER;
ALTER TABLE "Interim"
  ADD CONSTRAINT "Interim_jobFunctionId_fkey"
  FOREIGN KEY ("jobFunctionId") REFERENCES "JobFunction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Interim_jobFunctionId_idx" ON "Interim"("jobFunctionId");

-- b. Backfill: recover any free-text role that matches a managed function
-- name (case-insensitive, whitespace-trimmed), so those values are not lost
-- when "role" is dropped below. On the local database this matches 0 rows
-- (no intérimaire currently has a role), so it is a no-op there; it is kept
-- as an idempotent, protective statement because this migration also runs in
-- production, whose data was not inspected. It never overwrites an existing
-- link (WHERE "jobFunctionId" IS NULL) and never invents data — only exact
-- name matches are backfilled; anything else falls through and is dropped.
UPDATE "Interim" i
SET "jobFunctionId" = jf.id
FROM "JobFunction" jf
WHERE i."jobFunctionId" IS NULL
  AND lower(btrim(i."role")) = lower(btrim(jf."name"));

-- c. Drop the now-redundant free-text column.
ALTER TABLE "Interim" DROP COLUMN "role";
