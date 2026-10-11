import { expect } from "vitest";
import { canReachProject, type AccessContext } from "@/lib/accessContext";
import { PROJECT_SECTION_KEYS } from "@/lib/projectSections";
import { APP_AREA_KEYS } from "@/lib/appAreas";
import type { AccessScope } from "@/repository/users";

/**
 * Shared fixtures for the tests that stand in for `findAccessScopeByEmail`.
 *
 * Both exports exist because their inline versions drifted: the "account with
 * no job function" literal was copied six times, and the DENIED assertion was
 * `size > 0` — which a PARTIAL denial (one area hidden out of eleven) passes.
 */

/**
 * What `findAccessScopeByEmail` resolves for an account that EXISTS but has no
 * job function: nothing hidden, every project reachable. This is the
 * legitimate default of most fixtures — and the opposite of `null`, which
 * means "no account row" and resolves to DENIED.
 *
 * A function, not a constant: every call hands back fresh arrays, so a test
 * that mutates what it got cannot leak into the next one.
 */
export function accountWithoutFunction(): AccessScope {
  return { hiddenSections: [], hiddenAreas: [], projectScope: "ALL", assignedProjectIds: [] };
}

/**
 * Asserts a context is DENIED IN FULL: every project-section key hidden,
 * every app-area key hidden, and no project reachable.
 *
 * Compared against the domain tables (`PROJECT_SECTION_KEYS`,
 * `APP_AREA_KEYS`), never against a count or a "non-empty" check — those pass
 * a refusal that forgot one key, and a key added to the table later must
 * enter the refusal on its own. `projectIds` must be an EMPTY Set, never
 * `null`: `null` means "every project", the one answer DENIED must not give.
 */
export function expectDenied(ctx: AccessContext): void {
  expect([...ctx.hiddenSections].sort()).toEqual([...PROJECT_SECTION_KEYS].sort());
  expect([...ctx.hiddenAreas].sort()).toEqual([...APP_AREA_KEYS].sort());
  expect(ctx.projectIds).toEqual(new Set());
  expect(canReachProject(ctx, 1)).toBe(false);
}
