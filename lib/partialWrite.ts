/**
 * Pure helpers for the repository layer's PARTIAL writes (lot 5b).
 *
 * The write layer's types carry the semantics: `field?: T | null` means
 * "absent = leave the column alone, null = clear it, a value = set it". Prisma
 * already ignores an `undefined` in `data`, so a repository's `update` passes
 * the field through as it is — it never folds `undefined` into `null` (or into
 * a default). A field that needs converting on the way (an ISO string into a
 * Date) converts with a helper here, which keeps all three states intact.
 * tests/repository-partial-write.test.ts bans the folding forms in `update`s.
 */

/**
 * "AAAA-MM-JJ" or an ISO instant into a Date; `undefined` stays untouched,
 * `null` stays "clear". The overloads keep the result as narrow as the input,
 * so a NOT NULL column (which cannot take `null`) can use it too.
 */
export function dateColumn(value: string): Date;
export function dateColumn(value: string | undefined): Date | undefined;
export function dateColumn(value: string | null | undefined): Date | null | undefined;
export function dateColumn(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}
