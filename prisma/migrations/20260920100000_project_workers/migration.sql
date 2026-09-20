-- "Travailleurs" of a project: internal employees (User rows of the
-- organisation) ATTACHED to a chantier, listed on the Personnel page next to
-- Intérimaires and Sous-traitants, and assignable to a task / série /
-- catégorie exactly like an Interim. The attachment row is also the future
-- "projet de rattachement" a timesheet will hang off — out of scope here,
-- nothing below prevents it.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW TABLE, WHEN "_UserProjects" ALREADY LINKS USERS TO PROJECTS.
-- ---------------------------------------------------------------------------
--
-- "_UserProjects" (migration 20260801190000) is an ACCESS axis: it is read
-- only when the holder's JobFunction.projectScope is ASSIGNED, and it decides
-- which projects a user may REACH. "ProjectWorker" is a PRESENCE axis: who
-- works on the chantier. docs/CONVENTIONS.md forbids crossing the access axes,
-- and reusing the join table would cross them in both directions — attaching
-- a project manager as a worker would open the project to him (or not,
-- depending on his function's scope: one row, two meanings), and detaching a
-- worker could close a project he must keep seeing. It would also let a
-- content.edit holder on the Personnel page write access configuration that
-- is locked behind users.manage. And an implicit Prisma join table has no
-- surrogate id, so the task tables could not reference an attachment at all.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES TO EXISTING DATA: NOTHING. IT IS NOT DESTRUCTIVE.
-- ---------------------------------------------------------------------------
--
-- One new table (empty by construction), three NULLABLE columns with NO
-- DEFAULT (catalogue-only change on PostgreSQL 11+, no rewrite, no row
-- visited), and three CHECK constraints added NOT VALID (no row visited
-- either — see STEP 5). No existing row is read or written.
--
-- NO BACKFILL, and that is a decision: the house rule "keep the backfill even
-- on an empty local base" covers column REPLACEMENT, where a value must be
-- carried across before something is dropped. Nothing is replaced or dropped
-- here. "assignedWorkerId" is a brand-new column whose NULL means "no employee
-- assigned" — the state every existing task is in today, and a legitimate
-- permanent state. And "ProjectWorker" cannot be derived from "_UserProjects"
-- (see above): copying that table in would assert a presence nobody recorded.

-- ---------------------------------------------------------------------------
-- STEP 1 — the attachment table.
-- ---------------------------------------------------------------------------
--
-- Modelled on "Interim" — owned by exactly one project, cascade deleted with
-- it, assignable — minus every descriptive column: name, email and job
-- function live on "User" and are read through the FK, never copied here.
CREATE TABLE "ProjectWorker" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectWorker_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- STEP 2 — the optional assignee on the three task tables.
-- ---------------------------------------------------------------------------
--
-- Points at "ProjectWorker"."id" — the ATTACHMENT — and not at "User"."id",
-- exactly as "assignedInterimId" points at the per-project "Interim" row. Two
-- reasons, both about deletion: detaching an employee from a project then
-- clears their assignments on THAT project through the FK alone (a FK from
-- the task to "User" could not express "null the tasks of this project only",
-- the application would have to sweep them in a transaction), and deleting a
-- user reaches the tasks through the same chain (STEP 4).
ALTER TABLE "ProjectTask" ADD COLUMN "assignedWorkerId" INTEGER;
ALTER TABLE "ProjectTaskGroup" ADD COLUMN "assignedWorkerId" INTEGER;
ALTER TABLE "ProjectTaskCategory" ADD COLUMN "assignedWorkerId" INTEGER;

-- ---------------------------------------------------------------------------
-- STEP 3 — indexes. PostgreSQL does NOT create these by itself.
-- ---------------------------------------------------------------------------
--
-- One attachment per (project, employee), enforced by the database: a
-- duplicate would list the same person twice on the Personnel page and split
-- their progress tally in two. Its btree is led by "projectId", so it ALSO
-- serves the per-project read this feature is built around
--     SELECT ... FROM "ProjectWorker" WHERE "projectId" = $1
-- and the "Project" ON DELETE CASCADE scan — no separate index on "projectId".
CREATE UNIQUE INDEX "ProjectWorker_projectId_userId_key" ON "ProjectWorker"("projectId", "userId");

-- "userId" backs the "User" ON DELETE CASCADE scan and every "which projects is
-- this employee attached to" read: deleteUser's warning, and the project picker
-- of the future timesheet
--     SELECT ... FROM "ProjectWorker" WHERE "userId" = $1
CREATE INDEX "ProjectWorker_userId_idx" ON "ProjectWorker"("userId");

-- The three FK columns back the ON DELETE SET NULL scan when an attachment is
-- removed — without them, detaching ONE employee from ONE project sequentially
-- scans every task of EVERY project, three times, while holding a lock. Same
-- reason "assignedInterimId" got its index in 20260719092720_add_fk_indexes.
-- The progress aggregate (repository/tasks.ts, the "par travailleur" mirror of
-- computeProgressByInterim) filters on "projectId" first and groups on this
-- column: the existing "projectId" indexes do that work, these are not for it.
CREATE INDEX "ProjectTask_assignedWorkerId_idx" ON "ProjectTask"("assignedWorkerId");
CREATE INDEX "ProjectTaskGroup_assignedWorkerId_idx" ON "ProjectTaskGroup"("assignedWorkerId");
CREATE INDEX "ProjectTaskCategory_assignedWorkerId_idx" ON "ProjectTaskCategory"("assignedWorkerId");

-- ---------------------------------------------------------------------------
-- STEP 4 — foreign keys, and the delete chain they form.
-- ---------------------------------------------------------------------------
--
-- CASCADE from "Project": an attachment has no meaning outside its chantier
-- (same as "Interim", "SubcontractorCompany").
ALTER TABLE "ProjectWorker"
  ADD CONSTRAINT "ProjectWorker_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE from "User": deleting an account removes its attachments, and the
-- SET NULL below then clears that employee's assignments on every task, série
-- and catégorie — the same outcome, hop for hop, as deleting an "Interim"
-- today ("Interim" row gone, "assignedInterimId" nulled by the FK).
-- NOT RESTRICT: an attachment is not data worth outliving the account, unlike
-- equipment ownership or an open loan. The day a timesheet table references
-- "ProjectWorker", THAT table decides (Restrict there transitively protects the
-- user, as it should for payroll data) — nothing here pre-empts it.
-- Same behaviour as "_UserProjects_B_fkey" already has on this user.
ALTER TABLE "ProjectWorker"
  ADD CONSTRAINT "ProjectWorker_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL from the three task tables, matching "assignedInterimId" and
-- "assignedCompanyId" (20260719081924_add_task_assignee): removing the assignee
-- clears the assignment, it never deletes the task.
ALTER TABLE "ProjectTask"
  ADD CONSTRAINT "ProjectTask_assignedWorkerId_fkey"
  FOREIGN KEY ("assignedWorkerId") REFERENCES "ProjectWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskGroup"
  ADD CONSTRAINT "ProjectTaskGroup_assignedWorkerId_fkey"
  FOREIGN KEY ("assignedWorkerId") REFERENCES "ProjectWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskCategory"
  ADD CONSTRAINT "ProjectTaskCategory_assignedWorkerId_fkey"
  FOREIGN KEY ("assignedWorkerId") REFERENCES "ProjectWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- STEP 5 — at most ONE assignee per row, in the database.
-- ---------------------------------------------------------------------------
--
-- Until now the mutual exclusion of "assignedCompanyId" / "assignedInterimId"
-- lived in the action layer only (schemas/taskAssignee.ts::parseAssignee
-- yields exactly one non-null and repository/*.setAssignee writes both
-- columns). A third column triples the pairs that can disagree, and a row
-- carrying two assignees is counted by BOTH progress aggregates on the
-- dashboard. So the invariant is now also a CHECK — an admin script or a psql
-- session goes around Zod, never around a CHECK.
--
-- Added NOT VALID, and that is the whole point of this step:
--   - a NOT VALID CHECK is enforced on every INSERT and UPDATE from this
--     statement on, exactly like a validated one. Every write the application
--     performs from now on — including the first ever write to
--     "assignedWorkerId" — is constrained;
--   - existing rows are NOT scanned. The application could never have produced
--     a row with two assignees, but production data was not inspected, and
--     this migration runs at container start (docker-entrypoint.sh): a plain
--     CHECK would let ONE hand-edited row stop the container from serving. The
--     house rule for that case is "normalise first, then constrain, in the same
--     transaction, towards the value the application already displays" — and
--     here there is no single such value: the picker shows the company first
--     (components/AssigneePicker.tsx), while the "par intérimaire" tally still
--     counts the same row. Choosing one would be a functional change hidden in
--     a migration. NOT VALID makes the unverified hypothesis cost nothing.
--
-- Left to do, deliberately, as its own migration once production has been
-- READ (the source, not the rendered page):
--     SELECT count(*) FROM "ProjectTask"
--      WHERE num_nonnulls("assignedCompanyId","assignedInterimId","assignedWorkerId") > 1;
--     -- same on "ProjectTaskGroup" and "ProjectTaskCategory"; if all three are 0:
--     ALTER TABLE "ProjectTask" VALIDATE CONSTRAINT "ProjectTask_one_assignee_check";
--     -- (VALIDATE takes SHARE UPDATE EXCLUSIVE only: no rewrite, writes go on.)
-- Whether that has happened is observable without any privilege on the app:
--     SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%one_assignee%';
ALTER TABLE "ProjectTask"
  ADD CONSTRAINT "ProjectTask_one_assignee_check"
    CHECK (num_nonnulls("assignedCompanyId", "assignedInterimId", "assignedWorkerId") <= 1)
    NOT VALID;
ALTER TABLE "ProjectTaskGroup"
  ADD CONSTRAINT "ProjectTaskGroup_one_assignee_check"
    CHECK (num_nonnulls("assignedCompanyId", "assignedInterimId", "assignedWorkerId") <= 1)
    NOT VALID;
ALTER TABLE "ProjectTaskCategory"
  ADD CONSTRAINT "ProjectTaskCategory_one_assignee_check"
    CHECK (num_nonnulls("assignedCompanyId", "assignedInterimId", "assignedWorkerId") <= 1)
    NOT VALID;

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ENFORCE.
-- ---------------------------------------------------------------------------
--
-- 1. "User"."role" <> 'CLIENT'. A portal login is never an employee; a FK
--    proves a row exists, not what kind of row it is. Enforced in the action
--    layer at BOTH levers: attaching (check the role of the resolved user) and
--    updateUser switching an already-attached user's role to CLIENT. A
--    composite FK on ("id", "role") would need a denormalised role column
--    here and would break on every role change — rejected.
--
-- 2. Same-project assignment. Nothing here stops a task of project A from
--    pointing at a "ProjectWorker" of project B: the FK only proves the
--    attachment EXISTS. "assignedInterimId" has carried the very same hole
--    since it was added, and it is closed the same way — in
--    actions/taskAssignee, by resolving the attachment and comparing its
--    "projectId" with the target's own (404, never 403). A composite FK on
--    ("projectId", "id") is rejected for the reason 20260906120000 already
--    states: ON DELETE SET NULL on a composite key nulls EVERY column of the
--    key, including the NOT NULL "projectId" of the task.
