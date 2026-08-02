import { describe, it, expect } from "vitest";
import {
  APP_AREA_KEYS,
  TOP_LEVEL_APP_AREAS,
  isAppAreaKey,
  getAreaAncestors,
  normalizeHiddenAreas,
  resolveAreaLanding,
  type AreaLandingCandidate,
} from "@/lib/appAreas";

describe("isAppAreaKey", () => {
  it("accepts every known key", () => {
    for (const key of APP_AREA_KEYS) expect(isAppAreaKey(key)).toBe(true);
  });

  it("rejects unknown or tampered values", () => {
    expect(isAppAreaKey("bogus")).toBe(false);
    expect(isAppAreaKey("clients.bogus")).toBe(false);
    expect(isAppAreaKey("")).toBe(false);
    expect(isAppAreaKey("<script>")).toBe(false);
    // a project-section key must not be accepted as an app-area key — the two
    // axes are orthogonal (see lib/projectSections.ts)
    expect(isAppAreaKey("tasks")).toBe(false);
  });
});

describe("getAreaAncestors", () => {
  it("returns no ancestors for a top-level area", () => {
    for (const key of TOP_LEVEL_APP_AREAS) expect(getAreaAncestors(key)).toEqual([]);
  });

  it("returns the parent, root-first, for a sub-part key", () => {
    expect(getAreaAncestors("clients.contacts")).toEqual(["clients"]);
    expect(getAreaAncestors("clients.info")).toEqual(["clients"]);
    expect(getAreaAncestors("clients.projects")).toEqual(["clients"]);
    expect(getAreaAncestors("dashboard.stats")).toEqual(["dashboard"]);
    expect(getAreaAncestors("dashboard.recent")).toEqual(["dashboard"]);
    expect(getAreaAncestors("admin.users")).toEqual(["admin"]);
    expect(getAreaAncestors("admin.functions")).toEqual(["admin"]);
    expect(getAreaAncestors("admin.settings")).toEqual(["admin"]);
  });
});

describe("normalizeHiddenAreas", () => {
  it("keeps only known keys, deduped", () => {
    expect(normalizeHiddenAreas(["clients", "clients", "bogus", "admin.users"])).toEqual([
      "clients",
      "admin.users",
    ]);
  });

  it("returns [] for null, undefined, or empty input", () => {
    expect(normalizeHiddenAreas(null)).toEqual([]);
    expect(normalizeHiddenAreas(undefined)).toEqual([]);
    expect(normalizeHiddenAreas([])).toEqual([]);
  });

  it("drops a stale/removed key without throwing (forward-compatible)", () => {
    expect(normalizeHiddenAreas(["clients", "some.removed.area"])).toEqual(["clients"]);
  });
});

describe("resolveAreaLanding", () => {
  const candidates: AreaLandingCandidate[] = [
    { key: "dashboard", href: "/" },
    { key: "clients", href: "/clients" },
    { key: "projects", href: "/projects" },
  ];

  it("returns the first candidate that isn't hidden", () => {
    expect(resolveAreaLanding(candidates, new Set())).toBe("/");
    expect(resolveAreaLanding(candidates, new Set(["dashboard"]))).toBe("/clients");
    expect(resolveAreaLanding(candidates, new Set(["dashboard", "clients"]))).toBe("/projects");
  });

  it("returns null when every candidate is hidden", () => {
    expect(resolveAreaLanding(candidates, new Set(["dashboard", "clients", "projects"]))).toBeNull();
  });

  it("is unaffected by a hidden key outside the candidate list", () => {
    expect(resolveAreaLanding(candidates, new Set(["admin"]))).toBe("/");
  });
});
