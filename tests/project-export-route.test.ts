import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/requireAppUser", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/areaAccess", () => ({ canAccessArea: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  projectIdFilter: vi.fn(),
}));
vi.mock("@/repository/projects", () => ({ search: vi.fn() }));

import { GET } from "@/app/projects/export/route";
import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import { search } from "@/repository/projects";

const requireAppUserMock = vi.mocked(requireAppUser);
const canAccessAreaMock = vi.mocked(canAccessArea);
const getAccessContextMock = vi.mocked(getAccessContext);
const projectIdFilterMock = vi.mocked(projectIdFilter);
const searchMock = vi.mocked(search);

const BASE_PROJECT = {
  id: 1,
  name: "Toiture Nord",
  businessNumber: "AFF-1",
  type: "TOITURE",
  status: "EN_COURS",
  power: 9,
  budget: 1000,
  address: "1 rue du Soleil",
  notes: "",
  client: { email: "client@example.com" },
};

describe("GET /projects/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAppUserMock.mockResolvedValue({ ok: true, value: { email: "admin@example.com", role: "ADMIN" } });
    canAccessAreaMock.mockResolvedValue(true);
    getAccessContextMock.mockResolvedValue({
      email: "admin@example.com",
      role: "ADMIN",
      hiddenSections: new Set(),
      hiddenAreas: new Set(),
      projectIds: null,
    } as never);
    projectIdFilterMock.mockReturnValue(undefined);
  });

  it("renders a blank cell instead of throwing when a stored date is unparseable", async () => {
    // Simulates a row poisoned before the schema validated dates (or restored
    // from a pre-fix backup): the DB can still hold a Date object that
    // `.toISOString()` chokes on. The whole export must not 500 for every
    // other row because of one bad cell.
    searchMock.mockResolvedValue({
      projects: [
        { ...BASE_PROJECT, startDate: new Date(NaN), endDate: null },
        { ...BASE_PROJECT, id: 2, startDate: new Date("2026-01-01"), endDate: null },
      ],
      total: 2,
    } as never);

    const response = await GET(new Request("https://app.test/projects/export"));
    expect(response.status).toBe(200);
    const body = await response.text();

    const lines = body.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toContain("Start Date");
    // First data row: poisoned date renders as an empty cell, not a crash.
    expect(lines[1]).toContain('"Toiture Nord"');
    expect(lines[1]).not.toMatch(/Invalid/);
    // Second data row: a valid date still round-trips normally.
    expect(lines[2]).toContain("2026-01-01");
  });
});
