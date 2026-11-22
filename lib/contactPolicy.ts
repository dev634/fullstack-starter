/**
 * May the caller delete this contact? One rule, shared by the action
 * (actions/contacts/contacts.ts::deleteContact) and the screen that decides
 * whether to offer the delete button, so a control offered and an action
 * refused cannot drift apart.
 *
 * Deleting a contact also deletes its CLIENT portal login
 * (repository/contacts.ts::remove), which cuts the client's access to EVERY
 * project the contact is linked to. So a restricted caller may only do it when
 * ALL the links — trashed projects included — are inside its own scope.
 *
 * `scope` is the caller's project scope exactly as AccessContext carries it
 * (`ctx.projectIds`): `null` = unrestricted (always allowed) — the one
 * convention for "no restriction" in this codebase. A contact with no link at
 * all is allowed. An empty scope allows only a contact with no link.
 */
export function canRemoveContact(
  linkedProjectIds: readonly number[],
  scope: ReadonlySet<number> | null
): boolean {
  if (scope === null) return true;
  return linkedProjectIds.every((id) => scope.has(id));
}
