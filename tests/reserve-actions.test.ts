import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/repository/reserves", () => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/repository/reservePlans", () => ({ create: vi.fn(), findById: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/cloudinary", () => ({ uploadReservePlan: vi.fn(), destroyReservePlan: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addReserve, updateReserve, deleteReserve } from "@/actions/reserves/reserves";
import { requireRole } from "@/lib/authz";
import { create, update, remove } from "@/repository/reserves";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const initial = { type: null, message: "" } as const;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const validFields = {
  clientId: "1",
  projectId: "2",
  planId: "5",
  x: "0.5",
  y: "0.25",
  description: "Fissure au plafond",
  status: "OPEN",
};

describe("reserve actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addReserve refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await addReserve(initial, form(validFields));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addReserve rejects a missing description with a zodError", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const { description, ...noDesc } = validFields;
    void description;
    const res = await addReserve(initial, form(noDesc));
    expect(res.type).toBe("zodError");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addReserve creates the pin with its relative position + status", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    createMock.mockResolvedValue({ id: 9 } as never);
    const res = await addReserve(initial, form(validFields));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 5, x: 0.5, y: 0.25, description: "Fissure au plafond", status: "OPEN" })
    );
  });

  it("addReserve treats a blank latitude as no GPS (not 0)", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    createMock.mockResolvedValue({ id: 9 } as never);
    await addReserve(initial, form({ ...validFields, latitude: "", longitude: "" }));
    const passed = createMock.mock.calls[0][0];
    expect(passed.latitude).toBeUndefined();
    expect(passed.longitude).toBeUndefined();
  });

  it("updateReserve edits an existing pin", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    updateMock.mockResolvedValue({ id: 9 } as never);
    const res = await updateReserve(initial, form({ ...validFields, id: "9", status: "RESOLVED" }));
    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(9, expect.objectContaining({ status: "RESOLVED" }));
  });

  it("deleteReserve refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await deleteReserve(9, 1, 2);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });
});
