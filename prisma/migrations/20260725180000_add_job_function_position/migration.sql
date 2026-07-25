-- AlterTable: add a manual display order, backfilled from the current
-- alphabetical order so nothing visibly moves until an admin reorders.
ALTER TABLE "JobFunction" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT id, (ROW_NUMBER() OVER (ORDER BY name ASC) - 1) AS rn FROM "JobFunction"
)
UPDATE "JobFunction" jf SET "position" = ordered.rn FROM ordered WHERE jf.id = ordered.id;
