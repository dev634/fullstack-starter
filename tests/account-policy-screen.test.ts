import { describe, it, expect } from "vitest";
import {
  AREA_OF_LOCKED_CAPABILITY,
  PORTAL_EXPOSED_AREAS,
  assignableFunctionIds,
  heldFunctionLocks,
  isRestrictedAdmin,
  mayChangeHeldFunction,
  mayManageAccountWithFunction,
  mayProvisionPortalLogin,
  relevantHiddenAreas,
  unmanageableAccountIds,
} from "@/lib/accountPolicy";
import { LOCKED_CAPABILITIES } from "@/lib/capabilities";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { sessionAccountWhere } from "@/repository/users";
import type { AppAreaKey } from "@/lib/appAreas";

const restricted = { role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["clients.contacts"]) };
const free = { role: "ADMIN", hiddenAreas: new Set<AppAreaKey>() };
const boss = { role: "SUPERADMIN", hiddenAreas: new Set<AppAreaKey>() };
const FUNCTIONS: { id: number; hiddenAreas: AppAreaKey[] }[] = [
  { id: 1, hiddenAreas: ["clients"] },
  { id: 2, hiddenAreas: ["loans"] },
  { id: 3, hiddenAreas: [] },
];

describe("account policy, the screen's side", () => {
  it("only an ADMIN with hidden rubriques is restricted", () => {
    expect(isRestrictedAdmin(restricted)).toBe(true);
    expect(isRestrictedAdmin(free)).toBe(false);
    expect(isRestrictedAdmin(boss)).toBe(false);
    expect(isRestrictedAdmin({ role: "SUPERADMIN", hiddenAreas: new Set<AppAreaKey>(["loans"]) })).toBe(false);
  });
  it("assignable functions: only the covering ones for a restricted ADMIN, all for the others", () => {
    expect(assignableFunctionIds(restricted, FUNCTIONS)).toEqual([1]);
    expect(assignableFunctionIds(free, FUNCTIONS)).toEqual([1, 2, 3]);
    expect(assignableFunctionIds(boss, FUNCTIONS)).toEqual([1, 2, 3]);
  });
  it("unmanageable accounts: no function, or a function that hides less", () => {
    const accounts = [
      { id: 10, jobFunctionId: 1 },
      { id: 11, jobFunctionId: 2 },
      { id: 12, jobFunctionId: null },
      { id: 13, jobFunctionId: 99 },
    ];
    expect(unmanageableAccountIds(restricted, accounts, FUNCTIONS)).toEqual([11, 12, 13]);
    expect(unmanageableAccountIds(free, accounts, FUNCTIONS)).toEqual([]);
  });
  it("a held function, monotone: what it covered of the actor's it must still cover; deletion only if it covered none", () => {
    // restricted hides clients.contacts. "clients" covers it (parent).
    expect(mayChangeHeldFunction(restricted, ["clients"], null)).toBe(false);
    expect(mayChangeHeldFunction(restricted, ["clients"], [])).toBe(false);
    expect(mayChangeHeldFunction(restricted, ["clients"], ["clients.contacts"])).toBe(true);
    expect(mayChangeHeldFunction(restricted, ["clients"], ["clients", "loans"])).toBe(true);
    // A function that did not cover it reveals nothing new, whatever happens to it.
    expect(mayChangeHeldFunction(restricted, ["loans"], null)).toBe(true);
    expect(mayChangeHeldFunction(restricted, ["loans"], [])).toBe(true);
    expect(mayChangeHeldFunction(restricted, [], null)).toBe(true);
    expect(mayChangeHeldFunction(free, ["clients"], null)).toBe(true);
    expect(mayChangeHeldFunction(boss, ["clients"], [])).toBe(true);
  });
  it("degenerate row: a held function that covers nothing of the actor's can have its sections retouched (same areas)", () => {
    expect(mayChangeHeldFunction(restricted, [], [])).toBe(true);
    expect(mayChangeHeldFunction(restricted, ["loans"], ["loans"])).toBe(true);
  });
  it("heldFunctionLocks: computed with the same rule, for held functions only, restricted actors only", () => {
    const fns: { id: number; hiddenAreas: AppAreaKey[] }[] = [
      { id: 1, hiddenAreas: ["clients"] },
      { id: 2, hiddenAreas: ["loans"] },
      { id: 3, hiddenAreas: ["clients.contacts"] },
    ];
    expect(heldFunctionLocks(restricted, fns, [1, 2])).toEqual({
      deleteLockedIds: [1],
      lockedAreasByFunctionId: { 1: ["clients.contacts"], 2: [] },
    });
    expect(heldFunctionLocks(restricted, fns, [])).toEqual({ deleteLockedIds: [], lockedAreasByFunctionId: {} });
    expect(heldFunctionLocks(free, fns, [1, 2, 3])).toEqual({ deleteLockedIds: [], lockedAreasByFunctionId: {} });
  });
});

describe("the admin.* rubriques do not count (reachable only by ADMIN and above)", () => {
  const adminOnly = { role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["admin.functions"]) };
  it("every locked capability maps to the rubrique it guards", () => {
    for (const capability of LOCKED_CAPABILITIES) {
      expect(AREA_OF_LOCKED_CAPABILITY[capability], capability).toBeDefined();
    }
  });
  it("an ADMIN hiding only admin.* rubriques is not restricted, and keeps managing their team", () => {
    for (const key of ["admin", "admin.users", "admin.functions", "admin.settings"] as const) {
      expect(isRestrictedAdmin({ role: "ADMIN", hiddenAreas: new Set<AppAreaKey>([key]) }), key).toBe(false);
    }
    expect(mayManageAccountWithFunction(adminOnly, [])).toBe(true);
    expect(assignableFunctionIds(adminOnly, FUNCTIONS)).toEqual([1, 2, 3]);
  });
  it("only the reachable keys are demanded of a function", () => {
    const mixed = { role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["admin.functions", "loans", "admin"]) };
    expect(relevantHiddenAreas(mixed)).toEqual(["loans"]);
    expect(mayManageAccountWithFunction(mixed, ["loans"])).toBe(true);
    expect(mayManageAccountWithFunction(mixed, ["admin.functions"])).toBe(false);
  });
  it("a parent with at least one reachable child is reachable (dashboard)", () => {
    expect(relevantHiddenAreas({ role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["dashboard"]) })).toEqual(["dashboard"]);
  });
});

describe("portal logins are a relay (lot 5a, point 4)", () => {
  it("the portal exposes the projects rubrique", () => {
    expect(PORTAL_EXPOSED_AREAS).toEqual(["projects"]);
  });
  it("refused to a restricted ADMIN who hides projects; allowed otherwise", () => {
    expect(mayProvisionPortalLogin({ role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["projects"]) })).toBe(false);
    expect(mayProvisionPortalLogin(restricted)).toBe(true); // hides clients.contacts only
    expect(mayProvisionPortalLogin({ role: "ADMIN", hiddenAreas: new Set<AppAreaKey>(["loans", "projects"]) })).toBe(false);
    expect(mayProvisionPortalLogin(free)).toBe(true);
    expect(mayProvisionPortalLogin(boss)).toBe(true);
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => expect(normalizeEmail("  Jean.Dupont@X.FR ")).toBe("jean.dupont@x.fr"));
  it("is what every account lookup by e-mail goes through", () => {
    // Normalized input, matched by EXACT equality: a case-insensitive match is an
    // unescaped ILIKE (`_` and `%` become wildcards), see repository/users.ts.
    expect(sessionAccountWhere("Jean@X.fr ")).toEqual({ email: "jean@x.fr" });
  });
});
