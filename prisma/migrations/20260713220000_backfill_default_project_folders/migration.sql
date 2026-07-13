-- Data migration: retroactively give every existing project the standard
-- root folders (Plans, Vgp, Pvisotestes, Bulletins de livraisons) that new
-- projects now get automatically on creation. Idempotent — skips a folder
-- name for a project if a root folder with that name already exists there.
INSERT INTO "ProjectFolder" ("projectId", "name", "parentId")
SELECT p."id", d."name", NULL
FROM "Project" p
CROSS JOIN (VALUES ('Plans'), ('Vgp'), ('Pvisotestes'), ('Bulletins de livraisons')) AS d("name")
WHERE NOT EXISTS (
    SELECT 1 FROM "ProjectFolder" f
    WHERE f."projectId" = p."id" AND f."parentId" IS NULL AND f."name" = d."name"
);
