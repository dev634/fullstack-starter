import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/subcontractors", () => ({
  createCompany: vi.fn(),
  removeCompany: vi.fn(),
  addPerson: vi.fn(),
  removePerson: vi.fn(),
  findCompanyProjectId: vi.fn().mockResolvedValue(2),
  findPersonProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import {
  addSubcontractorCompany,
  deleteSubcontractorCompany,
  addSubcontractorPerson,
  deleteSubcontractorPerson,
} from "@/actions/subcontractors/subcontractors";
import { requireRole } from "@/lib/authz";
import { createCompany, removeCompany, addPerson, removePerson } from "@/repository/subcontractors";

const requireRoleMock = vi.mocked(requireRole);
const createCompanyMock = vi.mocked(createCompany);
const removeCompanyMock = vi.mocked(removeCompany);
const addPersonMock = vi.mocked(addPerson);
const removePersonMock = vi.mocked(removePerson);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("addSubcontractorCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addSubcontractorCompany(initial, formOf({ clientId: "1", projectId: "1", name: "Elec Pro" }));
    expect(res.type).toBe("error");
    expect(createCompanyMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addSubcontractorCompany(initial, formOf({ clientId: "1", projectId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createCompanyMock).not.toHaveBeenCalled();
  });

  it("creates the company when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createCompanyMock.mockResolvedValue({ id: 1 } as never);
    const res = await addSubcontractorCompany(initial, formOf({ clientId: "1", projectId: "2", name: "Elec Pro" }));
    expect(createCompanyMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2, name: "Elec Pro" }));
    expect(res.type).toBe("success");
  });
});

describe("deleteSubcontractorCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteSubcontractorCompany(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeCompanyMock).not.toHaveBeenCalled();
  });

  it("deletes the company when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeCompanyMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteSubcontractorCompany(1, 1, 2);
    expect(removeCompanyMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});

describe("addSubcontractorPerson", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addSubcontractorPerson(
      initial,
      formOf({ companyId: "1", clientId: "1", projectId: "1", name: "Jean" })
    );
    expect(res.type).toBe("error");
    expect(addPersonMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addSubcontractorPerson(
      initial,
      formOf({ companyId: "1", clientId: "1", projectId: "1", name: "" })
    );
    expect(res.type).toBe("zodError");
    expect(addPersonMock).not.toHaveBeenCalled();
  });

  it("adds the person, including optional jobFunctionId/phone, when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    addPersonMock.mockResolvedValue({ id: 1 } as never);
    const res = await addSubcontractorPerson(
      initial,
      formOf({ companyId: "3", clientId: "1", projectId: "2", name: "Jean Dupont", jobFunctionId: "4", phone: "0600000000" })
    );
    expect(addPersonMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 3, name: "Jean Dupont", jobFunctionId: 4, phone: "0600000000" })
    );
    expect(res.type).toBe("success");
  });
});

describe("deleteSubcontractorPerson", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteSubcontractorPerson(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removePersonMock).not.toHaveBeenCalled();
  });

  it("deletes the person when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removePersonMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteSubcontractorPerson(1, 1, 2);
    expect(removePersonMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});
