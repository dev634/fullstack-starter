/**
 * What a Prisma model delegate method DOES, decided by the one list that can be
 * closed: the READS. Verified against the generated client
 * (app/generated/prisma/models/User.ts, `UserDelegate`, Prisma 7): the delegate
 * exposes exactly eight reads — findUnique, findUniqueOrThrow, findFirst,
 * findFirstOrThrow, findMany, count, aggregate, groupBy — and nine writes —
 * create, createMany, createManyAndReturn, update, updateMany,
 * updateManyAndReturn, upsert, delete, deleteMany.
 *
 * A list of WRITES written by hand went stale the day the client grew
 * `updateManyAndReturn` / `createManyAndReturn`: a scan keyed on it saw nothing.
 * So the structural scans fail CLOSED: any method called on `<client>.<model>.`
 * that is not a known read is a write that must carry its guard. A method the
 * client gains tomorrow (or one a probe invents) is a write until someone lists
 * it here, with its reason, as a read.
 *
 * Exported as the single source of the scans of tests/helpers/accountWriterScan.ts,
 * tests/helpers/partialWriteScan.ts and tests/read-named-functions.test.ts.
 */

export const PRISMA_READ_METHODS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** Writes that only ever CREATE a new row: nothing earlier to invalidate. */
export const PRISMA_CREATE_METHODS: ReadonlySet<string> = new Set(["create", "createMany", "createManyAndReturn"]);

/** Writes that only ever DELETE: no column is written. */
export const PRISMA_DELETE_METHODS: ReadonlySet<string> = new Set(["delete", "deleteMany"]);

/** Not a read = a write (fail closed). */
export function isPrismaWrite(method: string): boolean {
  return !PRISMA_READ_METHODS.has(method);
}

/** Writes that change an EXISTING row through a `data` / `update` argument. */
export const PRISMA_UPDATE_METHODS: ReadonlySet<string> = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

/**
 * Every write the client is KNOWN to expose. Only for a receiver the scan cannot
 * identify as the Prisma client (`foo.bar.update()` where `foo` is neither
 * `prisma` nor `tx`): there, "not a read" would flag every `list.items.push()`,
 * so the known names are all we can recognise. On a receiver that IS the client
 * the scans use `isPrismaWrite` instead, which has no such list to go stale.
 */
export const PRISMA_KNOWN_WRITE_METHODS: ReadonlySet<string> = new Set([...PRISMA_CREATE_METHODS, ...PRISMA_DELETE_METHODS, ...PRISMA_UPDATE_METHODS]);
