/**
 * Why a scope guard (lib/access.ts) refused — typed, so a caller that must
 * not reveal WHICH refusal it was can decide from the reason, not from the
 * message text.
 *
 *   forbidden     the caller is outside the project / company scope
 *   absent        no such row
 *   inTrash       the row itself is in the trash
 *   parentInTrash a live project under a company in the trash
 *
 * `forbidden` and `absent` are the pair an anti-enumeration caller must keep
 * indistinguishable. The two trash reasons are only ever produced AFTER the
 * scope check passed, i.e. for a caller who already reaches the row: saying
 * "it is in the trash" tells them nothing they could not see.
 */
export type ScopeRefusal = "forbidden" | "absent" | "inTrash" | "parentInTrash";

/** A refused guard. `error` is what an action returns as-is; `reason` is for the caller's own decision and is never spread to the client. */
export type ScopeRefused = {
  error: { type: "error"; message: string };
  reason: ScopeRefusal;
};

export type ScopeCheckResult = { error: null } | ScopeRefused;

/**
 * The message for a caller that resolved the row in the database itself and
 * answers anti-enumeration: `forbidden` and `absent` collapse into the
 * caller's own `invalidId` message (a row out of scope reads exactly like one
 * that does not exist); the trash reasons pass through, since only a caller
 * already inside the scope ever gets them.
 *
 * The ONE place this masking lives. Anything that is not explicitly a trash
 * reason is masked: an unexpected reason fails closed, not open.
 */
export function scopeRefusalMessage(refused: ScopeRefused, invalidId: string): string {
  return refused.reason === "inTrash" || refused.reason === "parentInTrash"
    ? refused.error.message
    : invalidId;
}
