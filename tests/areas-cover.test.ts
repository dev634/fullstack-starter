import { describe, it, expect } from "vitest";
import { coversHiddenAreas, type AppAreaKey } from "@/lib/appAreas";

const c = (target: AppAreaKey[], actor: AppAreaKey[]) => coversHiddenAreas(target, actor);

describe("coversHiddenAreas(target, actor)", () => {
  it("equal sets cover each other", () => expect(c(["clients", "loans"], ["loans", "clients"])).toBe(true));
  it("a superset covers", () => expect(c(["clients", "loans", "admin"], ["clients"])).toBe(true));
  it("a missing key does not", () => expect(c(["clients"], ["clients", "loans"])).toBe(false));
  it("a hidden parent covers its sub-parts", () => {
    expect(c(["clients"], ["clients.contacts"])).toBe(true);
    expect(c(["admin"], ["admin.users", "admin.settings"])).toBe(true);
  });
  it("a hidden child does NOT cover its parent", () => expect(c(["clients.contacts"], ["clients"])).toBe(false));
  it("a sibling does not cover", () => expect(c(["clients.info"], ["clients.contacts"])).toBe(false));
  it("an empty target (no function) covers nothing", () => expect(c([], ["loans"])).toBe(false));
  it("anything covers an empty actor, an empty target included", () => {
    expect(c([], [])).toBe(true);
    expect(c(["loans"], [])).toBe(true);
  });
  it("accepts a Set", () =>
    expect(coversHiddenAreas(new Set<AppAreaKey>(["clients"]), new Set<AppAreaKey>(["clients.info"]))).toBe(true));
});
