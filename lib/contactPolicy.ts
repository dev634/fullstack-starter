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
 * `scopeProjectIds` is the caller's project scope: `null` = unrestricted
 * (always allowed). A contact with no link at all is allowed. An empty scope
 * allows only a contact with no link.
 */
export function canRemoveContact(
  linkedProjectIds: readonly number[],
  scopeProjectIds: readonly number[] | null
): boolean {
  if (scopeProjectIds === null) return true;
  const scope = new Set(scopeProjectIds);
  return linkedProjectIds.every((id) => scope.has(id));
}
