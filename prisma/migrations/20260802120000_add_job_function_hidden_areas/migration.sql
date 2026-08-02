-- Per-function app-area visibility: top-level rubric / sub-part keys hidden from
-- users who hold the function. Mirror of hiddenSections at whole-app scale.
-- Empty = hide nothing (see everything).
ALTER TABLE "JobFunction" ADD COLUMN "hiddenAreas" TEXT[] NOT NULL DEFAULT '{}';
