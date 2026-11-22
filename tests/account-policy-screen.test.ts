import { describe, it, expect } from "vitest";
import {
  assignableFunctionIds,
  isRestrictedAdmin,
  mayChangeHeldFunction,
  unmanageableAccountIds,
} from "@/lib/accountPolicy";
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
  it("a held function: deletion never, reconfiguration only while it covers", () => {
    expect(mayChangeHeldFunction(restricted, null)).toBe(false);
    expect(mayChangeHeldFunction(restricted, [])).toBe(false);
    expect(mayChangeHeldFunction(restricted, ["clients"])).toBe(true);
    expect(mayChangeHeldFunction(free, null)).toBe(true);
    expect(mayChangeHeldFunction(boss, [])).toBe(true);
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => expect(normalizeEmail("  Jean.Dupont@X.FR ")).toBe("jean.dupont@x.fr"));
  it("is what every account lookup by e-mail goes through", () => {
    expect(sessionAccountWhere("Jean@X.fr ")).toEqual({ email: "jean@x.fr" });
  });
});
