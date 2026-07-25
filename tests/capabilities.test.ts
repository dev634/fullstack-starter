import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAPABILITY_ROLE,
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
    const resolved = resolveAccessConfig({ "content.edit": "ADMIN", "users.manage": "SUPERADMIN" });
    expect(resolved["content.edit"]).toBe("ADMIN");
    expect(resolved["users.manage"]).toBe("SUPERADMIN");
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
