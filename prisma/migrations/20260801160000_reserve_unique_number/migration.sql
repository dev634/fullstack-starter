-- Give every réserve a stable, project-wide number.
--
-- Added nullable first, backfilled, then made NOT NULL: the columns must be
-- populated before the unique constraint can hold, and existing réserves have
-- to keep an order that matches what users already saw (createdAt, the same
-- order the UI numbered them by).

ALTER TABLE "Reserve" ADD COLUMN "projectId" INTEGER;
ALTER TABLE "Reserve" ADD COLUMN "number" INTEGER;

-- projectId comes from the owning plan; a plan never moves between projects.
UPDATE "Reserve" r
SET "projectId" = p."projectId"
FROM "ReservePlan" p
WHERE p.id = r."planId";

-- Number them per project in creation order, so a réserve that was #1 on the
-- first plan stays as close as possible to what was already printed.
WITH numbered AS (
  SELECT r.id,
         ROW_NUMBER() OVER (PARTITION BY r."projectId" ORDER BY r."createdAt", r.id) AS n
  FROM "Reserve" r
)
UPDATE "Reserve" r
SET "number" = numbered.n
FROM numbered
WHERE numbered.id = r.id;

ALTER TABLE "Reserve" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Reserve" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "Reserve_projectId_number_key" ON "Reserve"("projectId", "number");
