/**
 * "Is this project in the trash?" — written ONCE.
 *
 * A project is in the trash when it is trashed ITSELF, or when its company is:
 * trashing a company does not cascade to its projects
 * (repository/clients.ts::softDelete), so a live project under a trashed
 * company must read as "in the trash" too, or its page stays visible while
 * every button on it is refused (lib/access.ts::requireProjectAccess).
 *
 * Every guard (requireProjectAccess, requireTrashedProjectAccess via
 * repository/projects.ts::findTrashState) and every READ that decides whether
 * a project is visible (project hub, section pages, guarded assets, PDF
 * reports, client portal) calls this function, so the write guard and the
 * read cannot drift apart.
 *
 * `selfTrashed` is the project's own state alone, which is what restoring or
 * permanently deleting it must look at; `parentTrashed` is its company's
 * alone (a project restored under a trashed company would come back still
 * invisible).
 */
export type ProjectTrashInput = { deletedAt: Date | null; client: { deletedAt: Date | null } };

export type ProjectTrashState = { selfTrashed: boolean; parentTrashed: boolean; inTrash: boolean };

export function projectTrashState(row: ProjectTrashInput): ProjectTrashState {
  const selfTrashed = row.deletedAt !== null;
  const parentTrashed = row.client.deletedAt !== null;
  return { selfTrashed, parentTrashed, inTrash: selfTrashed || parentTrashed };
}
