-- Per-function project-section visibility: section keys hidden from users who
-- hold the function. Empty = hide nothing (see everything).
ALTER TABLE "JobFunction" ADD COLUMN "hiddenSections" TEXT[] NOT NULL DEFAULT '{}';
