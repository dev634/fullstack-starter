-- Personal equipment loans ("Prêts"): two NEW tables, nothing else touched.
--
-- Each internal user keeps a personal catalogue of tools (Equipment) and
-- lends them to another user (EquipmentLoan). The lender is the equipment's
-- owner — no lenderId column, it would duplicate ownerId. Nothing is attached
-- to a project. Who may see what is decided in the application.
--
-- NON-DESTRUCTIVE. Two new tables, no existing table, column or row is read
-- or written. There is deliberately NO backfill: the add → backfill → drop
-- rule exists for column REPLACEMENT, where data has to be carried over
-- before something disappears. Nothing is replaced here — there is nothing
-- to carry. Every CHECK below is validated against an empty table, so the
-- validating scan finds nothing to reject and the deployment cannot fail on
-- an existing row.

-- CreateTable
CREATE TABLE "Equipment" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "photoUrl" TEXT,
    "photoPublicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentLoan" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "borrowerId" INTEGER NOT NULL,
    "lentAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Postgres does not auto-index FK columns. ownerId backs "my catalogue" and
-- "what I lent" (loans joined through their equipment WHERE ownerId = me),
-- plus the RESTRICT scan when a user is deleted.
CREATE INDEX "Equipment_ownerId_idx" ON "Equipment"("ownerId");

-- CreateIndex
-- equipmentId backs the per-tool history (all loans, open and closed) and
-- the CASCADE scan when an equipment is deleted. The partial unique index
-- below only covers the OPEN loan — a closed history still needs this one.
CREATE INDEX "EquipmentLoan_equipmentId_idx" ON "EquipmentLoan"("equipmentId");

-- CreateIndex
-- borrowerId backs "what was lent to me" and the RESTRICT scan on user
-- deletion.
CREATE INDEX "EquipmentLoan_borrowerId_idx" ON "EquipmentLoan"("borrowerId");

-- ---------------------------------------------------------------------------
-- One open loan per tool at a time — PARTIAL UNIQUE INDEX.
-- ---------------------------------------------------------------------------
--
-- A tool is either in its owner's hands or in exactly one borrower's. Two
-- open loans on the same equipment would mean two people "hold" it. Zod
-- cannot enforce this (two requests can pass their own check concurrently),
-- a read-then-write in the action cannot either without a serialisable
-- transaction — only the database can, atomically, with a uniqueness rule
-- restricted to the rows where returnedAt IS NULL. Closed loans are history
-- and may repeat freely.
--
-- Prisma cannot express a partial index in schema.prisma. This index exists
-- ONLY here; the comment on model EquipmentLoan is its only trace for anyone
-- reading the schema instead of the migration. Two consequences, both
-- expected:
--   - `prisma migrate diff` (migrations → schema) reports this index as
--     drift. It is not a defect and must NOT be "fixed" by dropping it.
--   - A second open loan on the same tool fails with Prisma error P2002 on
--     "EquipmentLoan_equipmentId_open_key" — the application translates that
--     code into "already lent", it does not pre-check and hope.
--
-- Named with the _key suffix Prisma gives unique indexes, so it reads as one
-- in pg_indexes next to its siblings. Also serves "all open loans" queries:
-- a WHERE "returnedAt" IS NULL matches the index predicate, so Postgres can
-- scan this small index instead of the whole table — no separate index on
-- returnedAt is needed.
CREATE UNIQUE INDEX "EquipmentLoan_equipmentId_open_key"
    ON "EquipmentLoan"("equipmentId")
    WHERE "returnedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Shape of the text columns — enforced by the database, not only by Zod.
-- ---------------------------------------------------------------------------
--
-- An admin script, a data fix or a psql session goes around Zod, never around
-- a CHECK. Same three-part shape as the réserve labels on Project (migration
-- 20260823090000), and the same tiers from schemas/fields.ts, reused rather
-- than inventing new numbers:
--   name:      MAX_NAME_LENGTH = 200. A one-line label rendered in lists and
--              selects; btrim() > 0 so a blank name cannot exist; no control
--              character so a newline cannot be smuggled into a single line.
--   reference: MAX_REFERENCE_LENGTH = 200, nullable. The empty string is
--              rejected so "no reference" has exactly ONE representation:
--              NULL. The repository maps "" to NULL (as projects.ts does for
--              notes) — a writer that stores "" or "   " fails here with a
--              23514, which is the constraint doing its job.
--   note:      MAX_NOTE_LENGTH = 5000, nullable, non-blank. NO control-
--              character clause, unlike name: a note is a textarea and
--              legitimately contains newlines ([[:cntrl:]] matches \n).
--
-- Validated immediately: the tables were created a moment ago and are empty.
ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_name_check"
    CHECK (
      length(btrim("name")) > 0
      AND length("name") <= 200
      AND "name" !~ '[[:cntrl:]]'
    ),
  ADD CONSTRAINT "Equipment_reference_check"
    CHECK ("reference" IS NULL OR (
      length(btrim("reference")) > 0
      AND length("reference") <= 200
      AND "reference" !~ '[[:cntrl:]]'
    )),
  -- photoUrl and photoPublicId travel together: the URL is what the <img>
  -- reads, the public id is what Cloudinary's destroy() needs. One without
  -- the other is either an undeletable asset or an undisplayable one.
  -- (Client.photoUrl has no publicId column and re-derives it from the URL by
  -- regex — the coupling the guarded-delivery block in schema.prisma calls
  -- out; a new table does not have to inherit it.)
  ADD CONSTRAINT "Equipment_photo_pair_check"
    CHECK (("photoUrl" IS NULL) = ("photoPublicId" IS NULL));

-- ---------------------------------------------------------------------------
-- Date ordering — enforced by the database, not only by Zod.
-- ---------------------------------------------------------------------------
--
-- A tool cannot come back, nor be due, before it left. >= and not >: a tool
-- lent and returned the same day is a normal case, and all three columns hold
-- a DAY at 00:00 UTC (built from an <input type="date">, exactly like
-- Project.startDate and ProjectTask.dueDate — never `new Date()`, see the
-- comment on model EquipmentLoan), so equal is the same-day case.
--
-- A CHECK whose expression yields NULL counts as satisfied, which is exactly
-- the intent here: dueAt and returnedAt are nullable, and NULL means
-- "no due date" / "not returned yet" — nothing to compare. The explicit
-- IS NULL OR branch says so instead of relying on that rule silently.
ALTER TABLE "EquipmentLoan"
  ADD CONSTRAINT "EquipmentLoan_dueAt_check"
    CHECK ("dueAt" IS NULL OR "dueAt" >= "lentAt"),
  ADD CONSTRAINT "EquipmentLoan_returnedAt_check"
    CHECK ("returnedAt" IS NULL OR "returnedAt" >= "lentAt"),
  ADD CONSTRAINT "EquipmentLoan_note_check"
    CHECK ("note" IS NULL OR (
      length(btrim("note")) > 0
      AND length("note") <= 5000
    ));

-- ---------------------------------------------------------------------------
-- Foreign keys — every delete behaviour is explicit.
-- ---------------------------------------------------------------------------
--
-- Equipment.ownerId → User, RESTRICT. Deleting a user who still owns
-- equipment fails at the database. CASCADE would silently destroy the loans
-- with it — including an OPEN one held by someone else, the only record of
-- who physically has the tool; SET NULL would leave ownerless rows nobody
-- can manage. A refused deletion is recoverable by a human, a lost custody
-- record is not. Consequence for actions/users/users.ts::deleteUser: it must
-- detect this case and say so, not surface the 23503 as a server error.
--
-- EquipmentLoan.equipmentId → Equipment, CASCADE. A loan is the equipment's
-- history and means nothing without it (no denormalised name to fall back
-- on). A FK cannot tell an open loan from a closed one, so "an equipment
-- with an open loan cannot be deleted" belongs to the application (delete
-- with a `loans: { none: { returnedAt: null } }` filter, in one statement).
--
-- EquipmentLoan.borrowerId → User, RESTRICT. Same reasoning as ownerId: the
-- row is the trace of who holds the tool, and a FK cannot restrict only the
-- open ones. Mark the tool returned (or purge the closed history, as a
-- deliberate step in deleteUser), then delete the user.
--
-- ON UPDATE CASCADE is Prisma's default for every FK in this schema; kept
-- for uniformity, ids are never updated.

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLoan" ADD CONSTRAINT "EquipmentLoan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLoan" ADD CONSTRAINT "EquipmentLoan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Left to the application — crosses tables, which a CHECK cannot:
--   - borrowerId <> the equipment's ownerId (one does not lend to oneself);
--   - the borrower's User.role is not CLIENT (the portal does not take part);
--   - only the equipment's owner (or an admin) may create a loan on it;
--   - an equipment with an open loan is not deletable (see CASCADE above);
--   - a user who owns equipment or borrows anything is not deletable without
--     an explicit message (see RESTRICT above).
