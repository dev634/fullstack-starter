import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAPABILITY_ROLE,
  LOCKED_CAPABILITIES,
  resolveAccessConfig,
  hasCapability,
  meetsRole,
  rankOf,
  isRole,
} from "@/lib/capabilities";

describe("capabilities — role ranking", () => {
  it("ranks SUPERADMIN > ADMIN > EDITOR > VIEWER", () => {
    expect(rankOf("SUPERADMIN")).toBeGreaterThan(rankOf("ADMIN"));
    expect(rankOf("ADMIN")).toBeGreaterThan(rankOf("EDITOR"));
    expect(rankOf("EDITOR")).toBeGreaterThan(rankOf("VIEWER"));
  });

  it("treats unknown/nullish roles as rank 0", () => {
    expect(rankOf(undefined)).toBe(0);
    expect(rankOf(null)).toBe(0);
    expect(rankOf("NOPE")).toBe(0);
  });

  it("meetsRole admits a higher role and rejects a lower one", () => {
    expect(meetsRole("SUPERADMIN", "ADMIN")).toBe(true);
    expect(meetsRole("ADMIN", "ADMIN")).toBe(true);
    expect(meetsRole("EDITOR", "ADMIN")).toBe(false);
    expect(meetsRole(undefined, "VIEWER")).toBe(false);
  });

  it("ranks CLIENT below VIEWER and denies it content/admin capabilities", () => {
    expect(rankOf("CLIENT")).toBeGreaterThan(0); // above "no role"
    expect(rankOf("CLIENT")).toBeLessThan(rankOf("VIEWER"));
    // A portal login (CLIENT) meets none of the default content/admin gates.
    expect(meetsRole("CLIENT", "EDITOR")).toBe(false);
    expect(meetsRole("CLIENT", "VIEWER")).toBe(false);
    expect(meetsRole("CLIENT", "CLIENT")).toBe(true);
    // But an unauthenticated caller (rank 0) still meets nothing, not even CLIENT.
    expect(meetsRole(undefined, "CLIENT")).toBe(false);
  });

  it("isRole recognizes only the four known roles", () => {
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("editor")).toBe(false);
    expect(isRole(3)).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe("resolveAccessConfig — defaults + merge", () => {
  it("returns the defaults for empty/invalid input", () => {
    expect(resolveAccessConfig({})).toEqual(DEFAULT_CAPABILITY_ROLE);
    expect(resolveAccessConfig(undefined)).toEqual(DEFAULT_CAPABILITY_ROLE);
    expect(resolveAccessConfig(null)).toEqual(DEFAULT_CAPABILITY_ROLE);
    expect(resolveAccessConfig("garbage")).toEqual(DEFAULT_CAPABILITY_ROLE);
  });

  it("applies valid stored overrides", () => {
    // Passe 3b, point 4: "users.manage" used to be the second example here,
    // overridden UP to SUPERADMIN — that assertion went red the moment
    // users.manage joined LOCKED_CAPABILITIES below, and rightly so: a
    // locked capability now ignores ANY stored value, override included, the
    // same way settings.manage already did. Flipped to "content.import", an
    // unlocked capability, so this test keeps proving the generic merge
    // behavior instead of accidentally re-asserting the very defect this
    // pass closes. The locked-capability behavior itself has its own
    // dedicated tests below.
    const resolved = resolveAccessConfig({ "content.edit": "ADMIN", "content.import": "VIEWER" });
    expect(resolved["content.edit"]).toBe("ADMIN");
    expect(resolved["content.import"]).toBe("VIEWER");
    // untouched capabilities keep their default
    expect(resolved["content.trash"]).toBe(DEFAULT_CAPABILITY_ROLE["content.trash"]);
  });

  it("ignores invalid role values and unknown capabilities", () => {
    const resolved = resolveAccessConfig({
      "content.edit": "WIZARD",
      "content.trash": 7,
      "not.a.capability": "ADMIN",
    });
    expect(resolved["content.edit"]).toBe(DEFAULT_CAPABILITY_ROLE["content.edit"]);
    expect(resolved["content.trash"]).toBe(DEFAULT_CAPABILITY_ROLE["content.trash"]);
    expect(resolved).not.toHaveProperty("not.a.capability");
  });

  it("forces the locked settings.manage capability back to SUPERADMIN even if lowered", () => {
    const resolved = resolveAccessConfig({ "settings.manage": "EDITOR" });
    expect(resolved["settings.manage"]).toBe("SUPERADMIN");
  });

  // Passe 3b, point 4: functions.manage/users.manage joined LOCKED_CAPABILITIES
  // — an EDITOR granted functions.manage could otherwise call
  // setFunctionAreas on their OWN function and clear its hiddenAreas/
  // hiddenSections, annulling two of the three access axes for themselves.
  // Locking these two changes nothing for the ADMIN accounts that already
  // hold them (DEFAULT_CAPABILITY_ROLE is already ADMIN for both) — it only
  // stops either from being configured down to EDITOR/VIEWER.
  it("forces functions.manage back to its ADMIN default even if lowered", () => {
    const resolved = resolveAccessConfig({ "functions.manage": "EDITOR" });
    expect(resolved["functions.manage"]).toBe("ADMIN");
    expect(resolved["functions.manage"]).toBe(DEFAULT_CAPABILITY_ROLE["functions.manage"]);
  });

  it("forces users.manage back to its ADMIN default even if lowered", () => {
    const resolved = resolveAccessConfig({ "users.manage": "VIEWER" });
    expect(resolved["users.manage"]).toBe("ADMIN");
    expect(resolved["users.manage"]).toBe(DEFAULT_CAPABILITY_ROLE["users.manage"]);
  });

  it("ignores a stored override for functions.manage/users.manage even when raising, not just lowering — fully locked, same as settings.manage", () => {
    const resolved = resolveAccessConfig({ "functions.manage": "SUPERADMIN", "users.manage": "SUPERADMIN" });
    expect(resolved["functions.manage"]).toBe("ADMIN");
    expect(resolved["users.manage"]).toBe("ADMIN");
  });

  it("LOCKED_CAPABILITIES contains exactly the three capabilities that must never be configurable", () => {
    expect([...LOCKED_CAPABILITIES].sort()).toEqual(["functions.manage", "settings.manage", "users.manage"]);
  });

  it("rejects a CLIENT value on any capability (client contributions aren't scoped yet)", () => {
    const resolved = resolveAccessConfig({ "content.edit": "CLIENT", "content.trash": "CLIENT" });
    expect(resolved["content.edit"]).toBe(DEFAULT_CAPABILITY_ROLE["content.edit"]);
    expect(resolved["content.trash"]).toBe(DEFAULT_CAPABILITY_ROLE["content.trash"]);
  });
});

describe("hasCapability — resolved config gate", () => {
  it("gates on the resolved minimum role", () => {
    const config = resolveAccessConfig({ "content.edit": "ADMIN" });
    expect(hasCapability("ADMIN", "content.edit", config)).toBe(true);
    expect(hasCapability("EDITOR", "content.edit", config)).toBe(false);
    // a SUPERADMIN clears everything
    expect(hasCapability("SUPERADMIN", "settings.manage", config)).toBe(true);
    expect(hasCapability("ADMIN", "settings.manage", config)).toBe(false);
  });
});
