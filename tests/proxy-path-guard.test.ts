import { describe, it, expect } from "vitest";
import { normalizePathname, isProtectedPath, isPortalPath } from "@/lib/routeGuard";

describe("normalizePathname", () => {
  it("lowercases the path", () => {
    expect(normalizePathname("/PORTAIL")).toBe("/portail");
    expect(normalizePathname("/Clients")).toBe("/clients");
  });

  it("collapses a doubled leading slash", () => {
    expect(normalizePathname("//admin")).toBe("/admin");
  });

  it("decodes one level of percent-encoding", () => {
    expect(normalizePathname("/portail%2f..%2fadmin")).toBe("/portail/../admin");
  });

  it("falls back to the raw pathname on malformed percent-encoding", () => {
    expect(normalizePathname("/clients%")).toBe("/clients%");
  });
});

describe("isProtectedPath", () => {
  it("protects the known app roots regardless of case or a doubled slash", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/ADMIN")).toBe(true);
    expect(isProtectedPath("//admin")).toBe(true);
    expect(isProtectedPath("/Clients/42")).toBe(true);
    expect(isProtectedPath("/portail%2f..%2fadmin")).toBe(true);
  });

  it("leaves public auth pages open", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/forgot-password")).toBe(false);
  });

  it("protects /api/** by default", () => {
    expect(isProtectedPath("/api/some-future-route")).toBe(true);
  });

  it("keeps the NextAuth endpoint and the health check public", () => {
    expect(isProtectedPath("/api/auth/callback/credentials")).toBe(false);
    expect(isProtectedPath("/api/health")).toBe(false);
  });
});

describe("isPortalPath", () => {
  it("matches /portail regardless of case", () => {
    expect(isPortalPath("/portail/projets/1")).toBe(true);
    expect(isPortalPath("/PORTAIL")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(isPortalPath("/projects")).toBe(false);
  });
});
