-- Per-project label and colour for the two réserve statuses.
--
-- The ReserveStatus enum does not change: exactly OPEN and RESOLVED. Only
-- their presentation becomes configurable, per project, by whoever may write
-- on that project (requireProjectAccess — no new capability).
--
-- NULL = "not configured, use the product default". The defaults stay in the
-- application (i18n dictionary for the labels — they are per-locale — and the
-- shared colour constants #e11d48 / #16a34a), so these columns get NO DEFAULT:
-- a default written into every row would erase the difference between "never
-- configured" and "configured to the current default".
--
-- NON-DESTRUCTIVE. Four nullable columns with no default: PostgreSQL 11+ adds
-- those as a catalogue-only change, no table rewrite. No existing row is read
-- or written; every existing project keeps rendering exactly as it does today,
-- which is why there is deliberately NO backfill here (see the note at the
-- bottom).

ALTER TABLE "Project"
  ADD COLUMN "reserveOpenLabel"     TEXT,
  ADD COLUMN "reserveOpenColor"     TEXT,
  ADD COLUMN "reserveResolvedLabel" TEXT,
  ADD COLUMN "reserveResolvedColor" TEXT;

-- Colours end up interpolated into a <style> tag and into a style attribute,
-- and into the PDF report's fill colour. Constrain their shape in the database
-- and not only in Zod: an admin script, a data fix or a psql session goes
-- around Zod, never around a CHECK. Anchors are load-bearing — Postgres `~` is
-- an unanchored match, so without ^...$ a value like
-- "#000000; background:url(...)" would pass.
--
-- Labels are one-line pill text, rendered in HTML and drawn into the PDF:
--   - length capped at MAX_NAME_LENGTH (200, schemas/fields.ts — the
--     "name or title" tier, reused rather than inventing a new number);
--   - btrim() > 0 so the empty string and a whitespace-only string cannot be
--     stored: "not configured" must have exactly ONE representation (NULL),
--     otherwise the fallback chain gets a hole and a project renders an
--     invisible pill;
--   - no control characters, so a newline cannot be smuggled into a label that
--     the PDF renderer lays out on a single line.
--
-- These CHECKs are validated immediately: the columns were created a moment
-- ago and are NULL on every row, so the scan finds nothing to reject. (On a
-- large, already-populated table the pattern would be ADD CONSTRAINT ... NOT
-- VALID followed by VALIDATE CONSTRAINT, to avoid holding ACCESS EXCLUSIVE for
-- the length of a full scan. Project is small and the columns are empty, so
-- that split would buy nothing here.)
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_reserveOpenColor_check"
    CHECK ("reserveOpenColor" IS NULL OR "reserveOpenColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "Project_reserveResolvedColor_check"
    CHECK ("reserveResolvedColor" IS NULL OR "reserveResolvedColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "Project_reserveOpenLabel_check"
    CHECK ("reserveOpenLabel" IS NULL OR (
      length(btrim("reserveOpenLabel")) > 0
      AND length("reserveOpenLabel") <= 200
      AND "reserveOpenLabel" !~ '[[:cntrl:]]'
    )),
  ADD CONSTRAINT "Project_reserveResolvedLabel_check"
    CHECK ("reserveResolvedLabel" IS NULL OR (
      length(btrim("reserveResolvedLabel")) > 0
      AND length("reserveResolvedLabel") <= 200
      AND "reserveResolvedLabel" !~ '[[:cntrl:]]'
    ));

-- No index, on purpose. These four columns are read with the project row (by
-- primary key) and never appear in a WHERE, an ORDER BY or a JOIN. An index
-- here would be NULL for ~100% of rows, serve no query, and cost a write on
-- every project update.
--
-- No backfill, on purpose. The usual "add → backfill → drop" rule exists for
-- column REPLACEMENT, where data has to be moved before something disappears.
-- Nothing is replaced here: no column is dropped, no value has to be carried
-- over, and NULL already renders as today's #e11d48 / #16a34a plus the
-- dictionary labels. Writing those defaults into every existing project would
-- be an actively wrong backfill — it would mark every chantier as explicitly
-- customised, so a later change of the product default would reach none of
-- them and the edit form could no longer distinguish default from custom.
