-- Pointage, livraison 3 : les lignes, les signatures, la validation.
-- Requires 20260927100000_timesheet_worker_login (it only reads the fiches
-- that migration equipped; nothing here depends on the WORKER value itself).
--
-- One line = one person x one day x one project, arrival and departure, one
-- signature per line, validated by a manager, printed per ISO week.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES TO EXISTING DATA: NOTHING. IT IS NOT DESTRUCTIVE — BUT IT
-- CHANGES WHAT CAN BE DELETED FROM NOW ON.
-- ---------------------------------------------------------------------------
--
-- Two new, empty tables. Three new unique indexes on existing tables
-- ("Interim"(id, projectId), "SubcontractorPerson"(id, companyId),
-- "SubcontractorCompany"(id, projectId)) that cannot fail: each contains the
-- primary key, so every existing row already satisfies it. No existing column
-- is added, altered or dropped; no row is read or written. No backfill: there
-- is no timesheet data anywhere to carry over.
--
-- ⚠️ BEHAVIOUR CHANGE, deliberate (STEP 4): once a line references them, a
-- Project, ProjectWorker, Interim, SubcontractorPerson or SubcontractorCompany
-- can no longer be deleted — nor, through the Cascade from "User" to
-- "ProjectWorker" and from "Client" to "Project", the employee's account or
-- the client company. Every delete action of those rows must count its
-- blockers first and refuse with an explicit message (the countOwnershipBlockers
-- precedent of deleteUser), or the user gets a generic 23503.
--
-- ⚠️ FIRST OF THEIR KIND IN THIS REPOSITORY: a `date` column, a `bytea`
-- column, and PL/pgSQL triggers. `prisma migrate diff` does
-- not see triggers, functions or CHECKs — they exist only in this file and in
-- the database (pg_trigger, pg_constraint). A silent schema.prisma is not an
-- absence of constraint.

-- ---------------------------------------------------------------------------
-- STEP 1 — the two tables.
-- ---------------------------------------------------------------------------
--
-- Time model (question "le temps"):
--   "workDate"  DATE — the civil day, in Europe/Paris, on which the shift
--               STARTED. It carries the uniqueness "one line per person per
--               day" and the weekly read, and it is what a human means by
--               "lundi 30 mars".
--   "startAt" / "endAt"  TIMESTAMP(3) holding UTC — instants, stored the way
--               every other instant of this schema is (Prisma writes UTC). A
--               night shift crossing midnight is one line whose "endAt" falls
--               on the next civil day; a shift across the spring/autumn DST
--               change measures its true length (8 h of wall clock is 7 h of
--               work on 29 March 2026, 9 h on 25 October) because UTC has no
--               DST. Two `time` columns can represent neither.
--   Why NOT TIMESTAMPTZ, the textbook type — measured, not assumed, through
--   the client this app uses (PrismaClient + @prisma/adapter-pg, read-only
--   probe): the adapter reads a timestamptz by REPLACING its offset with
--   "+00:00" without converting it, so a value is right only while the
--   Postgres session zone is UTC. The same row came back 2 h late under a
--   session in 'Europe/Paris'. DATE and TIMESTAMP round-tripped identically
--   under both session zones and a Europe/Paris process. Today the server
--   runs Etc/UTC, but one `ALTER DATABASE ... SET timezone` would have
--   shifted every clocked hour silently. So: zoneless UTC storage, and the
--   zone written EXPLICITLY wherever it matters (the CHECK in STEP 5).
--   The ISO week is a function of "workDate" alone — its Monday is
--   "workDate" - (EXTRACT(ISODOW FROM "workDate")::int - 1), pure date
--   arithmetic. The zone only matters when the application turns "now" or an
--   entered wall-clock time into an instant and a day: in Europe/Paris, never
--   in the server's or the process's zone.
CREATE TABLE "TimesheetEntry" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER,
    "interimId" INTEGER,
    "subcontractorPersonId" INTEGER,
    "subcontractorCompanyId" INTEGER,
    "workDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" INTEGER,
    "validatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- The signature, 1-1 with its line ("entryId" is the primary key AND the FK),
-- in a table of its own so that no query listing lines can bring the image
-- bytes back by accident: they cost an explicit join. Stored as raw bytes
-- (bytea), never as a data: URL in text (a third larger, and a string that
-- looks displayable). Measured after server normalisation: 3.2-11.2 KB each,
-- ~6,900 a year, 30-40 MB a year. Values over 2 KB are moved out of line by
-- TOAST automatically, so the heap of this table stays small.
CREATE TABLE "TimesheetSignature" (
    "entryId" INTEGER NOT NULL,
    "image" BYTEA NOT NULL,
    "signedStartAt" TIMESTAMP(3) NOT NULL,
    "signedEndAt" TIMESTAMP(3) NOT NULL,
    "signerName" TEXT NOT NULL,
    "capturedById" INTEGER,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetSignature_pkey" PRIMARY KEY ("entryId")
);

-- ---------------------------------------------------------------------------
-- STEP 2 — targets for the composite foreign keys (existing tables).
-- ---------------------------------------------------------------------------
--
-- A line stores its "projectId" (the weekly read filters on it, and the
-- salaried FK needs it as a key column), and the database must PROVE it is the
-- project of the line's fiche — otherwise a line of an intérimaire of project
-- A could be printed on project B's sheet, and authorised against B. Composite
-- FKs do that, and they need a unique target. Each of these contains the
-- primary key, so it holds on every existing row by construction; the cost is
-- one small btree per table, on tables written a few times a week.
-- (The task assignee could not do this — see 20260906120000 — because its FKs
-- are SET NULL, which nulls every column of a composite key. These are
-- RESTRICT, so the objection does not apply.)
CREATE UNIQUE INDEX "Interim_id_projectId_key" ON "Interim"("id", "projectId");
CREATE UNIQUE INDEX "SubcontractorPerson_id_companyId_key" ON "SubcontractorPerson"("id", "companyId");
CREATE UNIQUE INDEX "SubcontractorCompany_id_projectId_key" ON "SubcontractorCompany"("id", "projectId");
-- The salaried target already exists: "ProjectWorker_projectId_userId_key"
-- (20260920100000).

-- ---------------------------------------------------------------------------
-- STEP 3 — indexes on the new tables. PostgreSQL creates none by itself.
-- ---------------------------------------------------------------------------
--
-- "Une personne x un jour x un projet" — one unique per population. Plain,
-- not partial: NULLs are distinct in a unique index, so the rows of the other
-- two populations never collide, and Prisma sees these (it would not see a
-- partial index). A fiche implies its project (an Interim row, a
-- SubcontractorPerson row belong to one project), so fiche + day is the whole
-- key; a salaried line needs "projectId" explicitly (one employee, several
-- chantiers the same day).
-- Each is led by its person column, so each also serves
--   - "this person's lines of the week", the WORKER's own view:
--       WHERE "interimId" = $1 AND "workDate" >= $2 AND "workDate" < $3
--   - the RESTRICT check when that fiche / attachment is deleted
--       (WHERE "interimId" = $1 AND "projectId" = $2).
CREATE UNIQUE INDEX "TimesheetEntry_userId_workDate_projectId_key" ON "TimesheetEntry"("userId", "workDate", "projectId");
CREATE UNIQUE INDEX "TimesheetEntry_interimId_workDate_key" ON "TimesheetEntry"("interimId", "workDate");
CREATE UNIQUE INDEX "TimesheetEntry_subcontractorPersonId_workDate_key" ON "TimesheetEntry"("subcontractorPersonId", "workDate");

-- The weekly sheet of a chantier, its validation screen and its PDF:
--   WHERE "projectId" = $1 AND "workDate" >= $2 AND "workDate" < $3
-- and the "Project" RESTRICT check.
CREATE INDEX "TimesheetEntry_projectId_workDate_idx" ON "TimesheetEntry"("projectId", "workDate");

-- RESTRICT check when a "SubcontractorCompany" is deleted: that FK's columns
-- are ("subcontractorCompanyId", "projectId") and no other index leads with
-- the first one.
CREATE INDEX "TimesheetEntry_subcontractorCompanyId_idx" ON "TimesheetEntry"("subcontractorCompanyId");

-- SET NULL scans when a user is deleted: without these, deleting ANY account
-- sequentially scans every line / signature ever recorded, holding a lock.
CREATE INDEX "TimesheetEntry_validatedById_idx" ON "TimesheetEntry"("validatedById");
CREATE INDEX "TimesheetSignature_capturedById_idx" ON "TimesheetSignature"("capturedById");

-- ---------------------------------------------------------------------------
-- STEP 4 — foreign keys: what a line attests cannot disappear under it.
-- ---------------------------------------------------------------------------
--
-- RESTRICT on everything a line attests (question "suppression d'une preuve").
-- Recensus of the paths that delete those rows, at 369c495 — every one of
-- them now fails while a line references what it deletes:
--   actions/interims::deleteInterim                  -> "Interim"
--   actions/subcontractors::deleteSubcontractorPerson  -> "SubcontractorPerson"
--   actions/subcontractors::deleteSubcontractorCompany -> "SubcontractorCompany"
--                                     (and its persons, by Cascade)
--   actions/projectWorkers::detachWorker             -> "ProjectWorker"
--   actions/users::deleteUser  -> "User" -> Cascade "ProjectWorker"
--   actions/projects::permanentlyDeleteProject       -> "Project" -> Cascade
--                                     to the three fiche tables
--   actions/clients::permanentlyDeleteClient -> "Client" -> Cascade "Project"
--   repository/contacts::remove deletes a CLIENT "User" — never attached as a
--   ProjectWorker (application invariant), so not a blocker in practice.
-- Soft deletes (deleteProject, deleteClient, deleteClients) touch no row and
-- are unaffected; a trashed project with hours simply cannot leave the trash.
-- No purge job, no import and no bulk delete exists for any of these tables
-- (searched: deleteMany / delete on these models, scripts/, prisma/seed.ts).
--
-- Why not the alternatives:
--   CASCADE   removing an intérimaire from a chantier, or an account, would
--             erase signed hours — the exact defect to prevent.
--   SET NULL  incompatible with the "exactly one person" CHECK (STEP 5):
--             nulling the only person column violates it, so the parent's
--             deletion fails anyway — with a 23514 nobody would understand.
--   archiving (deletedAt on the fiches) touches every read of three existing
--             tables for a benefit RESTRICT already gives. If the business
--             wants "remove from the chantier's list but keep the hours", that
--             is a flag on the fiche, added as its own change.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Salaried: the attachment (projectId, userId) must exist — you clock on a
-- chantier you are attached to. Detaching someone with hours there, or
-- deleting their account, fails.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_worker_fkey"
  FOREIGN KEY ("projectId", "userId") REFERENCES "ProjectWorker"("projectId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Intérimaire: the fiche, and it is of THIS project.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_interim_fkey"
  FOREIGN KEY ("interimId", "projectId") REFERENCES "Interim"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Subcontractor's person: the person belongs to this company, and the company
-- to THIS project — two hops, two composite FKs.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_subcontractorPerson_fkey"
  FOREIGN KEY ("subcontractorPersonId", "subcontractorCompanyId") REFERENCES "SubcontractorPerson"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_subcontractorCompany_fkey"
  FOREIGN KEY ("subcontractorCompanyId", "projectId") REFERENCES "SubcontractorCompany"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- (Composite FKs are MATCH SIMPLE: with "userId" / "interimId" /
-- "subcontractorPersonId" NULL, the corresponding FK is simply not checked —
-- which is what lets one table carry three populations.)

-- The validator and the capturing account: SET NULL, with a name snapshot on
-- the row. RESTRICT here would forbid ever deleting the account of a manager
-- who once validated a week — keeping a departed person's login alive to
-- protect a piece of paper. The proof is the stamp and the name.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_validatedById_fkey"
  FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimesheetSignature"
  ADD CONSTRAINT "TimesheetSignature_capturedById_fkey"
  FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT: a signed line cannot be deleted until its signature is — and the
-- signature trigger (STEP 6) refuses that once the line is validated.
ALTER TABLE "TimesheetSignature"
  ADD CONSTRAINT "TimesheetSignature_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "TimesheetEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- STEP 5 — row CHECKs. Tables are empty: nothing existing is judged.
-- ---------------------------------------------------------------------------

-- Exactly ONE person per line. "= 1", not the "<= 1" of the task assignee
-- (20260920100000): a line nobody worked is not a state, it is a bug.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_one_person_check"
    CHECK (num_nonnulls("userId", "interimId", "subcontractorPersonId") = 1);

-- The company column travels with the subcontractor person, never alone.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_subcontractor_pair_check"
    CHECK (("subcontractorPersonId" IS NULL) = ("subcontractorCompanyId" IS NULL));

-- The day is the Paris civil day of the arrival. An application computing it
-- in the server's zone (UTC), or truncating an instant, fails here instead of
-- filing an arrival at 00:30 on the previous day.
-- Two explicit conversions, because "startAt" is a zoneless timestamp holding
-- UTC: AT TIME ZONE 'UTC' makes it the instant it is, AT TIME ZONE
-- 'Europe/Paris' gives that instant's Paris wall-clock time. Neither reads
-- the session zone — probed identical under Etc/UTC, Europe/Paris and
-- America/New_York sessions. Both timezone(text, timestamp) and
-- timezone(text, timestamptz) are IMMUTABLE in pg_proc (PostgreSQL 16), as a
-- CHECK expects.
-- 'Europe/Paris' is written in the database on purpose: it is THE business
-- zone of this single-tenant app. A chantier in another zone would need a
-- zone on "Project" and this CHECK rewritten — not a silent reinterpretation.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_workDate_check"
    CHECK ("workDate" = (("startAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date);

-- Departure after arrival, and within 24 hours of it: a line is ONE shift of
-- ONE day. '24 hours' (absolute), not '1 day' (which follows DST). A
-- structural bound, not a labour-law ceiling — the legal daily maximum is a
-- business rule for the application to warn about, not for the database to
-- refuse.
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_hours_check"
    CHECK ("endAt" IS NULL OR ("endAt" > "startAt" AND "endAt" <= "startAt" + interval '24 hours'));

-- The validation stamp is whole or absent: validatedAt and validatorName
-- together; validatedById only while validated (it may be NULL while
-- validated — the validator's account was deleted, the name remains).
ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_validation_check"
    CHECK (
          ("validatedAt" IS NULL) = ("validatorName" IS NULL)
      AND ("validatedById" IS NULL OR "validatedAt" IS NOT NULL)
      AND ("validatorName" IS NULL OR "validatorName" <> '')
    );

-- A PNG, and at most 96 KiB. The bound is DERIVED from the normalisation, not
-- rounded: fit inside 600x300 px, palette of <= 16 colours (4 bits/px) gives
-- 300 rows x (1 filter byte + 300) = 90,300 raw bytes; zlib's worst case on
-- incompressible data adds < 50 bytes; PNG chunks (signature, IHDR, PLTE,
-- tRNS, IDAT headers, IEND) < 400 — about 90.7 KB for ANY trace. So no
-- legitimate output of that normalisation can hit it; it bounds every row and
-- the weekly PDF's memory (~150 signatures). It does NOT prove the
-- normalisation ran (raw canvas traces measured 5-81 KB pass it): that is the
-- server's job. Change the box or the palette, change this number — same PR,
-- same constant on the application side.
-- No [[:cntrl:]] clause anywhere in this migration: nothing to wire into
-- tests-integration/control-char-check-parity.
ALTER TABLE "TimesheetSignature"
  ADD CONSTRAINT "TimesheetSignature_image_check"
    CHECK (
          octet_length("image") <= 98304
      AND substring("image" from 1 for 8) = '\x89504e470d0a1a0a'::bytea
    );

-- The name shown at signing, snapshotted. Only "non-empty": it copies
-- Interim.name, SubcontractorPerson.name or the employee's display name, none
-- of which carries a CHECK — a stricter copy would make a legacy fiche
-- impossible to sign ("un plafond neuf juge le passé et les autres écrivains").
ALTER TABLE "TimesheetSignature"
  ADD CONSTRAINT "TimesheetSignature_signerName_check"
    CHECK ("signerName" <> '');

-- ---------------------------------------------------------------------------
-- STEP 6 — immutability, by trigger (question "immuabilité").
-- ---------------------------------------------------------------------------
--
-- A CHECK sees one row; "signed" and "validated" span two tables. Without
-- these, the rule "a signed line keeps its hours" would live in the action
-- alone, and an admin script, a psql fix or the next refactor would change the
-- hours under a signature that then attests something else.
--
-- What they DO NOT stop: a superuser disabling triggers
-- (ALTER TABLE ... DISABLE TRIGGER, session_replication_role = replica), and
-- TRUNCATE, which fires no row trigger. They stop accidents and application
-- bugs, not the database owner.
--
-- Concurrency (READ COMMITTED, the default): a BEFORE UPDATE row trigger runs
-- on the locked, latest version of the row, and each statement inside a
-- (volatile) PL/pgSQL function takes a fresh snapshot. The signature side
-- locks the line FOR UPDATE before looking at it. So "sign" and "edit the
-- hours" (or "validate" and "remove the signature") serialise on the line's
-- row lock, and whichever comes second sees the other's committed result.
--
-- Raised as check_violation (23514) with a CONSTRAINT name, so the
-- application can tell them apart from the CHECKs above — but it must refuse
-- these cases BEFORE writing; these are the net, not the door.

CREATE FUNCTION "timesheet_entry_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_signed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Validation requires a signature, and a signature requires the line to
    -- exist first: a line is never born validated.
    IF NEW."validatedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'TimesheetEntry: a line cannot be created already validated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetEntry_guard';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  is_signed := EXISTS (SELECT 1 FROM "TimesheetSignature" s WHERE s."entryId" = OLD."id");

  -- Signed: what the signature attests is frozen.
  IF is_signed AND (
       NEW."projectId"              IS DISTINCT FROM OLD."projectId"
    OR NEW."userId"                 IS DISTINCT FROM OLD."userId"
    OR NEW."interimId"              IS DISTINCT FROM OLD."interimId"
    OR NEW."subcontractorPersonId"  IS DISTINCT FROM OLD."subcontractorPersonId"
    OR NEW."subcontractorCompanyId" IS DISTINCT FROM OLD."subcontractorCompanyId"
    OR NEW."workDate"               IS DISTINCT FROM OLD."workDate"
    OR NEW."startAt"                IS DISTINCT FROM OLD."startAt"
    OR NEW."endAt"                  IS DISTINCT FROM OLD."endAt"
  ) THEN
    RAISE EXCEPTION 'TimesheetEntry %: signed, its person, day and hours can no longer change', OLD."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetEntry_guard';
  END IF;

  IF OLD."validatedAt" IS NULL THEN
    -- Validating: only a signed line.
    IF NEW."validatedAt" IS NOT NULL AND NOT is_signed THEN
      RAISE EXCEPTION 'TimesheetEntry %: an unsigned line cannot be validated', OLD."id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetEntry_guard';
    END IF;
  ELSIF NEW."validatedAt" IS NOT NULL THEN
    -- Still validated: the stamp is frozen, except validatedById -> NULL,
    -- which is this table's own FK acting when the validator's account is
    -- deleted (ON DELETE SET NULL runs as an UPDATE and fires this trigger).
    IF NEW."validatedAt" IS DISTINCT FROM OLD."validatedAt"
       OR NEW."validatorName" IS DISTINCT FROM OLD."validatorName"
       OR (NEW."validatedById" IS NOT NULL AND NEW."validatedById" IS DISTINCT FROM OLD."validatedById") THEN
      RAISE EXCEPTION 'TimesheetEntry %: a validation stamp is never rewritten', OLD."id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetEntry_guard';
    END IF;
  END IF;
  -- Validated -> not validated (all three cleared, which the CHECK enforces):
  -- un-validation. Allowed by the database, as a way out of a mistaken
  -- validation; WHO may do it is the application's decision. The signature
  -- stays, so the hours are still attested by the worker.

  RETURN NEW;
END;
$$;

CREATE TRIGGER "TimesheetEntry_guard"
  BEFORE INSERT OR UPDATE ON "TimesheetEntry"
  FOR EACH ROW EXECUTE FUNCTION "timesheet_entry_guard"();

CREATE FUNCTION "timesheet_signature_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Lock the line: a concurrent edit of its hours waits for us, or we wait
    -- for it and then compare against what it committed.
    SELECT e."startAt", e."endAt" INTO line
      FROM "TimesheetEntry" e WHERE e."id" = NEW."entryId" FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW; -- the foreign key reports the missing line itself
    END IF;
    IF line."endAt" IS NULL THEN
      RAISE EXCEPTION 'TimesheetSignature: line % has no departure time yet', NEW."entryId"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetSignature_guard';
    END IF;
    -- The signer attests the hours they were SHOWN, sent back by the app.
    IF NEW."signedStartAt" IS DISTINCT FROM line."startAt"
       OR NEW."signedEndAt" IS DISTINCT FROM line."endAt" THEN
      RAISE EXCEPTION 'TimesheetSignature: line % hours differ from the hours shown to the signer', NEW."entryId"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetSignature_guard';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Never modified. A wrong signature is deleted (while the line is not
    -- validated) and signed again. Sole exception: capturedById -> NULL, the
    -- FK's own ON DELETE SET NULL.
    IF NEW."entryId"       IS DISTINCT FROM OLD."entryId"
       OR NEW."image"         IS DISTINCT FROM OLD."image"
       OR NEW."signedStartAt" IS DISTINCT FROM OLD."signedStartAt"
       OR NEW."signedEndAt"   IS DISTINCT FROM OLD."signedEndAt"
       OR NEW."signerName"    IS DISTINCT FROM OLD."signerName"
       OR NEW."signedAt"      IS DISTINCT FROM OLD."signedAt"
       OR (NEW."capturedById" IS NOT NULL AND NEW."capturedById" IS DISTINCT FROM OLD."capturedById") THEN
      RAISE EXCEPTION 'TimesheetSignature: line % signature is never modified', OLD."entryId"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetSignature_guard';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'DELETE': not while the line is validated (un-validate first).
  SELECT e."validatedAt" INTO line
    FROM "TimesheetEntry" e WHERE e."id" = OLD."entryId" FOR UPDATE;
  IF FOUND AND line."validatedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'TimesheetSignature: line % is validated, its signature cannot be removed', OLD."entryId"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'TimesheetSignature_guard';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "TimesheetSignature_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "TimesheetSignature"
  FOR EACH ROW EXECUTE FUNCTION "timesheet_signature_guard"();

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ENFORCE (application layer).
-- ---------------------------------------------------------------------------
--
-- 1. WHO may create, sign, validate, un-validate or delete a line — the
--    ownership axis (a WORKER only on fiches bound to its login; an employee
--    only on its own attachment), the manager's right to validate, and the
--    project/section/area gates.
-- 2. The salaried "userId" belongs to an employee (role not CLIENT/WORKER) —
--    a FK proves the attachment exists, not the kind of account.
-- 3. One human appearing as two populations on the same chantier and day (an
--    Interim AND a SubcontractorPerson row): the database sees two fiches.
-- 4. The normalisation of the image (flatten, trim, fit 600x300, palette <= 16
--    colours, PNG) — the CHECK bounds its output, it cannot prove it ran.
-- 5. Breaks: a line is arrival -> departure; there is no pause column.
--    Whether hours worked = endAt - startAt is a decision still open.
