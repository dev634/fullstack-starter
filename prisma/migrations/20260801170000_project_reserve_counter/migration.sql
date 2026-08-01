-- Monotonic issuer for réserve numbers, per project.
--
-- Seeded from the highest number already issued so existing projects continue
-- where they left off. Using max(number) at insert time instead would reuse the
-- number of a deleted réserve, and a snagging report already sent cites it.

ALTER TABLE "Project" ADD COLUMN "reserveCounter" INTEGER NOT NULL DEFAULT 0;

UPDATE "Project" p
SET "reserveCounter" = COALESCE(
  (SELECT MAX(r."number") FROM "Reserve" r WHERE r."projectId" = p.id),
  0
);
