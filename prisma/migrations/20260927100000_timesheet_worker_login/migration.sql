-- Pointage, livraison 2 : l'accès confiné des intérimaires et des personnes de
-- sous-traitants. Three things, and nothing that clocks a single hour yet
-- (lines, signatures and validations are 20260927110000, shipped separately):
--   1. a WORKER role;
--   2. an e-mail on "Interim" and "SubcontractorPerson";
--   3. a MATERIALISED link from each of those fiches to its WORKER login.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES TO EXISTING DATA: NOTHING. IT IS NOT DESTRUCTIVE.
-- ---------------------------------------------------------------------------
--
-- Four NULLABLE columns with NO DEFAULT (catalogue-only on PostgreSQL 11+, no
-- rewrite), two CHECKs and four unique indexes that only look at those new
-- columns — NULL on every existing row, so the CHECKs validate trivially
-- (NULL passes, and a brand-new column cannot hold a value anybody wrote) and
-- the unique indexes cannot collide (NULLs are distinct). Two FKs on the same
-- new columns. One enum value appended.
--
-- NO BACKFILL, and that is a decision, not an omission: the house rule "keep
-- the backfill even on an empty base" covers REPLACING a column, where a value
-- must be carried across before something is dropped. Nothing is replaced
-- here. "email" NULL means "no address given" and "workerUserId" NULL means
-- "no timesheet login bound" — the true state of every existing fiche, and a
-- legitimate permanent one. Filling them from anywhere would invent an
-- identity binding nobody made — on an authorisation column.
--
-- ⚠️ THE APPLICATION CODE MUST SHIP WITH THIS MIGRATION. Adding 'WORKER' to the
-- Prisma enum makes `tsc` fail in actions/users/users.ts (hasMinRole takes the
-- app's own Role union) and in UsersManager.tsx (Record<Role, …> maps) — 10
-- errors in 2 files, measured on 369c495. The migration itself is inert in
-- production (no account can hold WORKER until an action writes it), but the
-- schema that produces it does not compile without its code.

-- ---------------------------------------------------------------------------
-- STEP 1 — the role.
-- ---------------------------------------------------------------------------
--
-- Same form as 'CLIENT' (20260725210000). ALTER TYPE … ADD VALUE is allowed
-- inside a transaction since PostgreSQL 12 (prod and dev run 16), on the one
-- condition that the new value is not USED before the transaction commits —
-- nothing below mentions 'WORKER', keep it that way.
--
-- Deliberately inert: userRoleSchema (schemas/user.ts) does not list it, so no
-- form can assign it yet. It MUST stay unassignable until proxy.ts confines it
-- the way it confines CLIENT: every role check in the app today is a deny-list
-- on 'CLIENT' (proxy, requireAppUser, blockClientFromApp, the user pickers,
-- the RBAC matrix's MATRIX_MIN_ROLES), and a WORKER would pass all of them.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WORKER';

-- ---------------------------------------------------------------------------
-- STEP 2 — the e-mail on the two external fiches.
-- ---------------------------------------------------------------------------
ALTER TABLE "Interim" ADD COLUMN "email" TEXT;
ALTER TABLE "SubcontractorPerson" ADD COLUMN "email" TEXT;

-- Canonical form, enforced by the database: this column is the KEY an admin
-- binds a login with (STEP 3), so two spellings of one address must not be
-- able to coexist — "Jean@X.fr" and "jean@x.fr" would be two people to a
-- unique index and one person to a human.
--   - lower-case, so equality is exact and indexable;
--   - no whitespace, no control character (C1 included: [[:cntrl:]] under a
--     UTF-8 database) — an address contains neither;
--   - an "@" with something on each side;
--   - at most 254 characters = MAX_EMAIL_LENGTH (schemas/fields.ts).
-- NOT a full address grammar: that is Zod's job. The door is
-- z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH) piped into an e-mail
-- check — Zod 4's e-mail check is ASCII-only, so every value it lets through
-- satisfies every clause here (JS toLowerCase and Postgres lower() agree on
-- ASCII; the trim runs before the check). Zod stricter, never looser.
-- ⚠️ The [[:cntrl:]] clause makes tests-integration/control-char-check-parity
-- discover both constraints (it selects pg_get_constraintdef LIKE '%cntrl%'):
-- both must be wired into its GUARDED table with the schema that writes the
-- column, or that test turns red.
ALTER TABLE "Interim"
  ADD CONSTRAINT "Interim_email_check" CHECK (
    "email" IS NULL OR (
          "email" = lower("email")
      AND "email" !~ '[[:cntrl:][:space:]]'
      AND "email" LIKE '_%@_%'
      AND char_length("email") <= 254
    )
  );
ALTER TABLE "SubcontractorPerson"
  ADD CONSTRAINT "SubcontractorPerson_email_check" CHECK (
    "email" IS NULL OR (
          "email" = lower("email")
      AND "email" !~ '[[:cntrl:][:space:]]'
      AND "email" LIKE '_%@_%'
      AND char_length("email") <= 254
    )
  );

-- ---------------------------------------------------------------------------
-- STEP 3 — the materialised login link.
-- ---------------------------------------------------------------------------
--
-- WHY A FOREIGN KEY AND NOT "match the session e-mail against the fiche e-mail
-- at read time". Whoever may write a fiche's e-mail — today any holder of
-- content.edit with the Intérimaires / Sous-traitants section on a project
-- they reach, through addInterim / addSubcontractorPerson — could, under a
-- read-time match, hand that fiche to ANY login by typing its address: the
-- login would then see the project in its timesheet and clock and sign hours
-- under the fiche's name. That is an identity binding decided by a content
-- editor. With a FK, the address is only the key an admin uses to find (or
-- create) the login; the binding itself is a separate, users.manage write —
-- the CLIENT precedent, where Contact.email seeds the login and
-- Contact.userId (20260725211000) is the binding.
--
-- Unlike Contact.userId, NOT unique on its own: a person has one fiche PER
-- PROJECT ("Interim" carries "projectId"; a "SubcontractorCompany" belongs to
-- one project), so one login binds several fiches — one per project.
ALTER TABLE "Interim" ADD COLUMN "workerUserId" INTEGER;
ALTER TABLE "SubcontractorPerson" ADD COLUMN "workerUserId" INTEGER;

-- SET NULL: deleting the login unbinds its fiches; the fiches — and, from
-- livraison 3, the hours clocked on them — stay. Same choice as Contact.userId.
ALTER TABLE "Interim"
  ADD CONSTRAINT "Interim_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubcontractorPerson"
  ADD CONSTRAINT "SubcontractorPerson_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- STEP 4 — uniqueness, which doubles as the indexes these columns need.
-- ---------------------------------------------------------------------------
--
-- One fiche per ADDRESS per project (per company for subcontractors): two
-- fiches with one address on one chantier would make "which fiche does this
-- login clock for here" ambiguous, and "un login par personne" means one
-- address is one person. Led by "email", so the same btree serves the bind
-- lookup (every fiche bearing the address the admin is binding):
--     SELECT ... FROM "Interim" WHERE "email" = $1
-- ⚠️ This refuses a generic agency address shared by several temps on one
-- chantier — by design (it would be one login for several people), but the
-- form must say so instead of surfacing the P2002 as a server error.
CREATE UNIQUE INDEX "Interim_email_projectId_key" ON "Interim"("email", "projectId");
CREATE UNIQUE INDEX "SubcontractorPerson_email_companyId_key" ON "SubcontractorPerson"("email", "companyId");

-- One fiche per LOGIN per project (per company), same reason. Led by
-- "workerUserId", so it serves the WORKER's scope read — the project picker
-- of its timesheet —
--     SELECT ... FROM "Interim" WHERE "workerUserId" = $1
-- and the "User" ON DELETE SET NULL scan (Postgres does not index the
-- referencing side of a FK by itself).
-- Not enforceable here, because it spans tables: one login bound to an
-- Interim AND a SubcontractorPerson of the same project, or to persons of two
-- companies of the same project. The binding action refuses it.
CREATE UNIQUE INDEX "Interim_workerUserId_projectId_key" ON "Interim"("workerUserId", "projectId");
CREATE UNIQUE INDEX "SubcontractorPerson_workerUserId_companyId_key" ON "SubcontractorPerson"("workerUserId", "companyId");

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ENFORCE (application layer).
-- ---------------------------------------------------------------------------
--
-- 1. The bound User has role WORKER (a FK proves a row exists, not its kind),
--    and a WORKER is never attached as a "ProjectWorker" (salaried presence).
-- 2. lower("User"."email") = "email" at bind time; editing the e-mail of a
--    bound fiche clears "workerUserId" in the same write.
-- 3. There is NO update path for either fiche today (create and delete only):
--    existing fiches can only receive an e-mail once livraison 2 adds one.
