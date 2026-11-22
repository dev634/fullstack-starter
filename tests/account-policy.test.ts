import { describe, it, expect } from "vitest";
import { ROLES, type Role } from "@/lib/capabilities";
import { assignableRoles, canAssignRole, canManageAccount, isPrivilegedRole } from "@/lib/accountPolicy";

// Lot 1, F2 — the one rule behind actions/users AND the users screen.
describe("accountPolicy", () => {
  it("only ADMIN and SUPERADMIN are privileged", () => {
    expect(ROLES.filter(isPrivilegedRole).sort()).toEqual(["ADMIN", "SUPERADMIN"]);
  });

  describe("canManageAccount", () => {
    const rows: [Role, Role, boolean, boolean][] = [
      // actor, target, isSelf, expected
      ["SUPERADMIN", "SUPERADMIN", false, true],
      ["SUPERADMIN", "ADMIN", false, true],
      ["SUPERADMIN", "CLIENT", false, true],
      ["ADMIN", "SUPERADMIN", false, false],
      ["ADMIN", "SUPERADMIN", true, false],
      ["ADMIN", "ADMIN", false, false],
      ["ADMIN", "ADMIN", true, true],
      ["ADMIN", "EDITOR", false, true],
      ["ADMIN", "VIEWER", false, true],
      ["ADMIN", "CLIENT", false, true],
      ["EDITOR", "ADMIN", true, false],
      ["EDITOR", "VIEWER", false, true],
    ];
    it.each(rows)("%s on a %s account (self: %s) -> %s", (actor, target, self, expected) => {
      expect(canManageAccount(actor, target, self)).toBe(expected);
    });
  });

  describe("canAssignRole / assignableRoles", () => {
    it("a SUPERADMIN may assign every role", () => {
      for (const r of ROLES) expect(canAssignRole("SUPERADMIN", r)).toBe(true);
      expect(assignableRoles("SUPERADMIN")).toEqual(["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER"]);
    });
    it("an ADMIN may assign EDITOR, VIEWER and CLIENT, never ADMIN or SUPERADMIN", () => {
      expect(ROLES.filter((r) => canAssignRole("ADMIN", r)).sort()).toEqual(["CLIENT", "EDITOR", "VIEWER"]);
      expect(assignableRoles("ADMIN")).toEqual(["EDITOR", "VIEWER"]);
    });
    it("nobody may assign a role above their own", () => {
      expect(canAssignRole("EDITOR", "ADMIN")).toBe(false);
      expect(canAssignRole("VIEWER", "EDITOR")).toBe(false);
    });
  });
});
