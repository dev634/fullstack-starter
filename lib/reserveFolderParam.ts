/**
 * Query param the réserves browser navigates with.
 *
 * Deliberately NOT `folder` — the Files module already owns that on the very
 * same project page, and the two sections must be able to be open in different
 * folders at once. Shared here so the page (which reads it) and the row/
 * breadcrumb links (which write it) can never drift apart.
 */
export const RESERVE_FOLDER_PARAM = "rfolder";

/** Parse the param into a folder id, or null for the project root. */
export function parseReserveFolderId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}
