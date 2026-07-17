import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/projectMaterials", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  findByProject: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addMaterial, deleteMaterial } from "@/actions/projectMaterials/projectMaterials";
import { requireRole } from "@/lib/authz";
import { create, remove } from "@/repository/projectMaterials";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("material actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addMaterial refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Panneau 400W", quantity: "10" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "", quantity: "10" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial rejects a negative quantity with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: "-1" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.quantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial accepts a zero quantity — a valid out-of-stock state", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: "0" }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
  });

  it("addMaterial creates the material when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Panneau 400W", quantity: "24", unit: "pièce" })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, name: "Panneau 400W", quantity: 24, unit: "pièce" })
    );
    expect(res.type).toBe("success");
  });

  it("addMaterial passes optional supplier/reference through", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Onduleur",
        quantity: "1",
        supplierName: "Solaredge",
        reference: "SE-5000",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ supplierName: "Solaredge", reference: "SE-5000" })
    );
  });

  it("addMaterial rejects a linked task without a required quantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Panneau", quantity: "10", link: "task:5" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial passes taskId/requiredQuantity through when linked to a task", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Panneau 400W",
        quantity: "10",
        link: "task:5",
        requiredQuantity: "24",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, taskGroupId: undefined, requiredQuantity: 24 })
    );
  });

  it("addMaterial rejects a linked task series without a required quantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Panneau", quantity: "10", link: "group:7" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial passes taskGroupId/requiredQuantity through when linked to a series", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Panneau 400W",
        quantity: "10",
        link: "group:7",
        requiredQuantity: "24",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskGroupId: 7, taskId: undefined, requiredQuantity: 24 })
    );
  });

  it("deleteMaterial refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteMaterial(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteMaterial deletes the material when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteMaterial(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});
