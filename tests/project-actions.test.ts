import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/projects", () => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  findByClient: vi.fn(),
  findById: vi.fn(),
}));
vi.mock("@/repository/clients", () => ({ findByEmail: vi.fn() }));
vi.mock("@/repository/projectActivity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addProject, updateProject, deleteProject, getProjectsForClient } from "@/actions/projects/projects";
import { requireSession, requireRole } from "@/lib/authz";
import { create, update, remove, softDelete, findByClient, findById } from "@/repository/projects";

const requireSessionMock = vi.mocked(requireSession);
const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const softDeleteMock = vi.mocked(softDelete);
const findByClientMock = vi.mocked(findByClient);
const findByIdMock = vi.mocked(findById);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("project actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addProject(initial, formOf({ clientId: "1", name: "Toiture" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addProject rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addProject(initial, formOf({ clientId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addProject creates the project with a default ETUDE status when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addProject(initial, formOf({ clientId: "1", name: "Toiture principale" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 1, name: "Toiture principale", status: "ETUDE" })
    );
    expect(res.type).toBe("success");
  });

  it("addProject treats blank power/budget as absent rather than a validation error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addProject(
      initial,
      formOf({ clientId: "1", name: "Toiture", power: "", budget: "" })
    );
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ power: undefined, budget: undefined })
    );
  });

  it("addProject parses a decimal power value", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addProject(initial, formOf({ clientId: "1", name: "Toiture", power: "9.5" }));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ power: 9.5 }));
  });

  it("updateProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await updateProject(initial, formOf({ id: "1", clientId: "1", name: "Toiture" }));
    expect(res.type).toBe("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updateProject updates when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await updateProject(
      initial,
      formOf({ id: "1", clientId: "1", name: "Toiture", status: "EN_COURS" })
    );
    expect(updateMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Toiture", status: "EN_COURS" }));
    expect(res.type).toBe("success");
  });

  it("deleteProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteProject(1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteProject soft-deletes the project when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    softDeleteMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteProject(1, 2);
    expect(softDeleteMock).toHaveBeenCalledWith(1);
    expect(removeMock).not.toHaveBeenCalled();
    expect(res.type).toBe("success");
  });

  it("getProjectsForClient refuses without a session", async () => {
    requireSessionMock.mockResolvedValue({ type: "error", message: "Unauthorized." });
    const res = await getProjectsForClient(1);
    expect(res.type).toBe("error");
    expect(findByClientMock).not.toHaveBeenCalled();
  });

  it("getProjectsForClient returns projects for any authenticated session", async () => {
    requireSessionMock.mockResolvedValue(null);
    findByClientMock.mockResolvedValue([{ id: 1, name: "Toiture" }] as never);
    const res = await getProjectsForClient(1);
    expect(res.type).toBe("success");
    expect(findByClientMock).toHaveBeenCalledWith(1);
  });
});
