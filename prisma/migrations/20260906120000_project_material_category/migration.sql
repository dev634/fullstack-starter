-- Per-project MATERIAL categories: filing the matériel of a chantier by the
-- nature of the article (Électrique, Couverture, Fixations…), independently of
-- the task that consumes it.
--
-- ---------------------------------------------------------------------------
-- THE NAMING TRAP, FIRST, BECAUSE THIS IS WHERE IT BITES.
-- ---------------------------------------------------------------------------
--
-- "ProjectMaterial"."taskCategoryId" ALREADY EXISTS, and it is NOT this. It
-- points at "ProjectTaskCategory" — a phase of the WORKS — and answers "which
-- part of the job is this material needed FOR?". Together with
-- "requiredQuantity" it drives the stock indicator (lib/materialStock.ts), and
-- it is one of three mutually exclusive link targets (task / series / task
-- category).
--
-- "ProjectMaterial"."materialCategoryId", added by this migration, points at
-- "ProjectMaterialCategory" and answers "WHAT is this article?". It is filing
-- and nothing else: no stock indicator, no progress figure, no assignee.
--
-- Both columns set on the same row is the NORMAL case, not a contradiction: a
-- breaker filed under "Électrique" that is needed for "Raccordement". Neither
-- is derivable from the other, and clearing one must never clear the other.
-- Every identifier here is prefixed by the KIND of category it points at —
-- taskCategory* versus materialCategory* — so the two can never be read as the
-- same thing in a column list, in a query, or in a code review.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES TO EXISTING DATA: NOTHING. IT IS NOT DESTRUCTIVE.
-- ---------------------------------------------------------------------------
--
-- One new table (empty by construction) and one NULLABLE column with NO DEFAULT
-- on "ProjectMaterial". PostgreSQL 11+ adds such a column as a catalogue-only
-- change: no table rewrite, no row visited, only a brief ACCESS EXCLUSIVE lock
-- to update the catalogue. No existing row is read or written, and every
-- material already in production keeps rendering exactly as it does today —
-- unfiled, which is a state the UI has to render anyway.
--
-- NO BACKFILL, AND THAT IS A DECISION, NOT AN OMISSION. The house rule "keep
-- the backfill even when the local database is empty" exists for column
-- REPLACEMENT, where a value must be carried across before something is
-- dropped. Nothing is replaced or dropped here. "materialCategoryId" is a
-- brand-new column on which NULL carries MEANING: "non classé" — a legitimate
-- and PERMANENT state, not a hole waiting to be filled. Filing every existing
-- material into some default category would invent a decision nobody made, and
-- would destroy the single distinction this column exists to record: "not filed"
-- versus "filed there on purpose". Same reasoning, and the same deliberate
-- refusal, as migration 20260823090000 for the réserve status columns. Please do
-- not "fix" this later by adding an UPDATE.
--
-- For the same reason there is no column DEFAULT and no seeded starter
-- category. Which categories exist is a per-project, per-trade decision; and a
-- default category name would be a user-visible string, which per house rule
-- lives in the i18n dictionary rather than being frozen into one locale by a
-- database DEFAULT.

-- ---------------------------------------------------------------------------
-- STEP 1 — the category table.
-- ---------------------------------------------------------------------------
--
-- Modelled on "ProjectTaskCategory": owned by exactly one project, cascade
-- deleted with it, one name. Minus everything that makes a task category a unit
-- of work (no groups, no tasks, no assignee).
CREATE TABLE "ProjectMaterialCategory" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMaterialCategory_pkey" PRIMARY KEY ("id")
);

-- Constrain the name in the DATABASE, not only in Zod: an admin script, a data
-- fix or a psql session goes around Zod, never around a CHECK. The three
-- clauses are deliberately identical, in the same order, to the
-- Project.reserve*Label CHECKs of migration 20260823090000, rather than freshly
-- invented — two constraints that disagree about what a name is are not two
-- constraints:
--
--   - btrim() > 0, so neither the empty string nor a whitespace-only string can
--     be stored. A blank category would render as an empty <option>
--     indistinguishable from "non classé", which is exactly what NULL already
--     means: "unfiled" must keep exactly ONE representation.
--   - length <= 200 = MAX_NAME_LENGTH (schemas/fields.ts), the shared
--     "name or title" tier already used for task, project and folder names. One
--     shared constant, not a second number that can drift from it.
--   - no control characters, so a newline cannot be smuggled into a label that
--     the UI and the PDF report lay out on a single line.
--
-- This CHECK is validated immediately and CANNOT fail: the table was created
-- three statements ago and holds zero rows. A ceiling introduced today judges
-- the past as well as the future — but here there is no past to judge, which is
-- precisely why it is cheap to add NOW rather than once the table is populated.
ALTER TABLE "ProjectMaterialCategory"
  ADD CONSTRAINT "ProjectMaterialCategory_name_check"
    CHECK (
      length(btrim("name")) > 0
      AND length("name") <= 200
      AND "name" !~ '[[:cntrl:]]'
    );

-- ---------------------------------------------------------------------------
-- STEP 2 — the optional link from the material.
-- ---------------------------------------------------------------------------
--
-- Nullable, no DEFAULT. See the "NO BACKFILL" note at the top of this file
-- before changing anything about this line.
ALTER TABLE "ProjectMaterial" ADD COLUMN "materialCategoryId" INTEGER;

-- ---------------------------------------------------------------------------
-- STEP 3 — indexes. PostgreSQL does NOT create these by itself.
-- ---------------------------------------------------------------------------
--
-- Postgres indexes the REFERENCED side of a foreign key (it is a primary key),
-- never the REFERENCING side. Without these two, every parent deletion has to
-- sequentially scan the child table to find the rows it must cascade or null
-- out — while holding a lock.
--
-- "ProjectMaterialCategory"."projectId" backs the ON DELETE CASCADE scan when a
-- project is deleted, and the query this feature is built around, the category
-- list of one project:
--     SELECT * FROM "ProjectMaterialCategory" WHERE "projectId" = $1
CREATE INDEX "ProjectMaterialCategory_projectId_idx" ON "ProjectMaterialCategory"("projectId");

-- "ProjectMaterial"."materialCategoryId" earns its index twice over. It backs
-- the ON DELETE SET NULL scan when a category is deleted — without it, deleting
-- ONE category of ONE project sequentially scans every material row of EVERY
-- project — and it backs the grouped/filtered read the UI exists to do:
--     SELECT * FROM "ProjectMaterial"
--      WHERE "projectId" = $1 AND "materialCategoryId" = $2
-- The cost is one more index entry per material INSERT/UPDATE, on a table
-- written a handful of times per delivery. Accepted.
--
-- No index on "ProjectMaterialCategory"."name", on purpose: it is displayed and
-- sorted inside a single project list — a handful of rows already fetched by
-- "projectId" — and never searched. If a "contains" search ever lands on it, a
-- btree will NOT serve it: that would be a GIN trigram index, like
-- Project_name_trgm_idx (migration 20260802160000).
CREATE INDEX "ProjectMaterial_materialCategoryId_idx" ON "ProjectMaterial"("materialCategoryId");

-- ---------------------------------------------------------------------------
-- STEP 4 — foreign keys, and the two DIFFERENT delete behaviours.
-- ---------------------------------------------------------------------------
--
-- CASCADE from Project: a category belongs to exactly one chantier and has no
-- meaning outside it. Deleting the project takes its categories with it — same
-- as ProjectTaskCategory, ProjectFolder and ReservePlanFolder.
ALTER TABLE "ProjectMaterialCategory"
  ADD CONSTRAINT "ProjectMaterialCategory_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL from ProjectMaterial, matching exactly what "taskCategoryId" already
-- does, and for the reason that column already states: deleting a CATEGORY must
-- never delete the MATERIAL filed under it. The stock is real — it is physically
-- on the chantier — and losing a filing decision must not delete the inventory
-- line that records it. The affected materials fall back to NULL = "non classé",
-- a state they were already allowed to be in, so the deletion costs the filing
-- and strictly nothing else, and the fallback needs no special handling.
--
-- NOT RESTRICT: forcing someone to empty a category before deleting it turns a
-- filing mistake into a chore, and the recovery ("re-file 40 lines by hand") is
-- worse than the loss.
-- NOT CASCADE: that would silently destroy inventory. Worth writing down,
-- because CASCADE is the CORRECT answer eight lines above and the catastrophic
-- one here — which is exactly how a wrong one gets copy-pasted in.
ALTER TABLE "ProjectMaterial"
  ADD CONSTRAINT "ProjectMaterial_materialCategoryId_fkey"
  FOREIGN KEY ("materialCategoryId") REFERENCES "ProjectMaterialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ENFORCE.
-- ---------------------------------------------------------------------------
--
-- 1. Cross-project filing. Nothing here stops a material of project A from
--    being linked to a category of project B: the foreign key only proves the
--    category EXISTS. "taskCategoryId" has carried the very same hole since it
--    was added, and it is closed the same way — in the action layer, by
--    resolving the category from the database and comparing its "projectId"
--    with the material own projectId (404, never 403, on mismatch: hors
--    périmètre => introuvable).
--    A composite foreign key on ("projectId", "id") WOULD enforce it in the
--    database, and it is rejected on purpose rather than overlooked: ON DELETE
--    SET NULL on a composite key nulls EVERY column of that key, including the
--    NOT NULL "projectId". Deleting a category would then abort with a not-null
--    violation instead of unfiling its materials — turning the safe behaviour
--    chosen just above into a hard error.
--
-- 2. Uniqueness of ("projectId", "name"). A plain UNIQUE would still admit
--    'Électrique', 'électrique ' and 'ÉLECTRIQUE' side by side, so it would buy
--    confidence it does not deliver. The constraint that would actually mean
--    something is a functional unique index on
--    ("projectId", lower(btrim("name"))) — which Prisma cannot express in
--    schema.prisma, and which ProjectTaskCategory does not carry either.
--    If duplicates become a real complaint, that gets its own migration, and
--    that migration MUST de-duplicate the existing rows in the SAME transaction
--    that creates the index: on a populated table a unique index is validated on
--    the spot, and since production applies pending migrations at container
--    start (docker-entrypoint.sh), a single duplicate pair would not merely fail
--    to be cleaned up — it would stop the container from serving.
