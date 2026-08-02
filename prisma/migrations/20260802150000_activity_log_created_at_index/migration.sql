-- Index createdAt on the two append-only activity-log tables. They grow
-- unboundedly (a row per mutation, never purged) and are always read
-- ORDER BY createdAt DESC with OFFSET pagination — without this index every
-- page does a full sort of the whole table.

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivityLog_createdAt_idx" ON "ProjectActivityLog"("createdAt");
