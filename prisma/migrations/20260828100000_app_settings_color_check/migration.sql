-- Database CHECK on the two AppSettings theme colours.
--
-- WHAT WAS ACTUALLY TRUE BEFORE THIS MIGRATION. Project.reserveOpenColor and
-- Project.reserveResolvedColor have carried an anchored CHECK since migration
-- 20260823090000. AppSettings.primaryColor and AppSettings.accentColor never
-- had one: the table had no constraint of type 'c' at all. The claim that
-- these colours are "validated three times (Zod, database CHECK, safeHex)"
-- held for Project's columns and not for these two — two layers, not three.
--
-- Same sink, same stakes: app/layout.tsx interpolates both values into the
-- TEXT of a <style nonce> element (:root{--primary:...;--accent:...}). That is
-- a style BLOCK, which is worse than an attribute — a stray "}" closes the
-- rule and opens another one of the attacker's choosing. Zod (hexColor) only
-- guards the one form-driven writer; a psql session, a data fix or an admin
-- script goes around Zod, never around a CHECK.

-- ---------------------------------------------------------------------------
-- STEP 1 of 2 — normalise before constraining. The order is the whole point.
-- ---------------------------------------------------------------------------
--
-- Production applies pending Prisma migrations at container start
-- (docker-entrypoint.sh). A CHECK added to a POPULATED table is validated
-- against the existing rows there and then, so a single non-conforming value
-- does not merely fail to be cleaned up: the migration aborts, the entrypoint
-- fails, and the container never serves. The failure mode of guessing wrong
-- here is not "a bad colour survives", it is "the deployment is down".
--
-- What we know about the production row is weaker than it looks. Both columns
-- are NOT NULL with valid DEFAULTs ('#3b82f6' / '#8b5cf6', migration
-- 20260714130934), and the only Zod-guarded writer (updateSettings) goes
-- through hexColor. But uploadLogo and removeLogo re-persist the colours they
-- just READ from the database without revalidating them, so any value that
-- ever got in by another route is carried forward untouched; and nothing
-- prevents a direct UPDATE in psql. The production row has never been
-- inspected from here. Its conformity is an assumption, and this migration is
-- written so that the assumption being wrong costs nothing.
--
-- WHICH VALUE THE NORMALISATION WRITES, AND WHY THAT ONE: '#3b82f6' for
-- primaryColor and '#8b5cf6' for accentColor. Those are this table's own
-- column DEFAULTs, and byte-for-byte the fallbacks already handed to safeHex
-- at every sink (app/layout.tsx, lib/email/render.ts). So for any row this
-- UPDATE touches, the application is ALREADY painting exactly that colour —
-- safeHex replaced the stored garbage on every render. The UPDATE writes into
-- the database the colour the user is already looking at: zero visible change,
-- by construction. Any cleverer repair (btrim, case-fold, expand a #abc
-- shorthand) would resurrect a colour this app has never once displayed, which
-- is a silent rebrand smuggled inside a security fix.
--
-- THIS IS NOT THE "ADD -> BACKFILL -> DROP" BACKFILL, and it is not the wrong
-- backfill that 20260823090000 deliberately refused either. Nothing is being
-- replaced or dropped. There is no "never configured" state to protect: these
-- columns are NOT NULL, NULL carries no meaning here, and a row cannot be
-- distinguished as "explicitly chosen" versus "left at the default" in the
-- first place. The WHERE clause only touches rows the database is about to
-- reject anyway — a conforming row, including a legitimately customised one,
-- is not read as changed and not written.
--
-- updatedAt / updatedBy are deliberately left alone. This is a schema repair,
-- not a settings edit by a human, and the audit trail should keep pointing at
-- the last real one. (Prisma's @updatedAt is client-side only, so raw SQL does
-- not bump it regardless.)
--
-- Prisma applies one migration file inside one transaction, so this UPDATE and
-- the ADD CONSTRAINT below commit or roll back together. There is no window in
-- which the row is normalised but unconstrained, or constrained but stale.

UPDATE "AppSettings"
   SET "primaryColor" = '#3b82f6'
 WHERE "primaryColor" !~ '^#[0-9a-fA-F]{6}$';

UPDATE "AppSettings"
   SET "accentColor" = '#8b5cf6'
 WHERE "accentColor" !~ '^#[0-9a-fA-F]{6}$';

-- ---------------------------------------------------------------------------
-- STEP 2 of 2 — the constraint itself, validated immediately.
-- ---------------------------------------------------------------------------
--
-- Anchors are load-bearing. PostgreSQL's `~` is an UNANCHORED match, so
-- without ^...$ the value '#000000; background:url(https://evil/)' matches and
-- passes. Same shape, character for character, as schemas/appSettings.ts's
-- hexColor and as lib/color.ts's safeHex: three layers that disagree about
-- what a colour is are not three layers.
--
-- No `IS NULL OR ...` branch, unlike Project's equivalent CHECKs — those
-- columns are nullable, these two are NOT NULL. A CHECK returning NULL counts
-- as satisfied, so if either column is ever made nullable, this constraint
-- silently starts accepting NULL: add the IS NULL branch at that moment, as a
-- decision, rather than pre-installing a hole today.
--
-- VALIDATED, not NOT VALID. NOT VALID skips the existing rows, which is
-- precisely the hole this migration exists to close — it would enforce the
-- shape on future writes while leaving whatever is already stored unchecked,
-- and the documentation would stay false. The only thing NOT VALID buys is a
-- shorter ACCESS EXCLUSIVE lock during the validating scan, and AppSettings is
-- a singleton table: one row. The scan is instant, and step 1 has already
-- guaranteed it finds nothing to reject.
ALTER TABLE "AppSettings"
  ADD CONSTRAINT "AppSettings_primaryColor_check"
    CHECK ("primaryColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "AppSettings_accentColor_check"
    CHECK ("accentColor" ~ '^#[0-9a-fA-F]{6}$');

-- No index, on purpose. Both columns live in a one-row singleton table read by
-- primary key (id = 1) and never appear in a WHERE, an ORDER BY or a JOIN.
--
-- Known consequence, and a wanted one: uploadLogo and removeLogo re-persist
-- the colours they read without revalidating them. From now on, if someone
-- hand-writes a malformed colour in psql, the next logo upload fails loudly
-- with a 23514 check violation instead of quietly carrying the bad value
-- forward. That is the constraint doing its job at the write it was invisible
-- to before.
