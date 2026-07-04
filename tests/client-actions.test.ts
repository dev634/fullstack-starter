import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the action's boundaries so we exercise the orchestration (auth guard,
// validation error mapping, delegation) without a DB, network or NextAuth.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/service/clients", () => ({ createClient: vi.fn() }));
vi.mock("@/repository/clients", () => ({
  findById: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadClientPhoto: vi.fn(),
  destroyClientPhoto: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addClient, deleteClient } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { createClient } from "@/service/clients";
import { findById, remove } from "@/repository/clients";

const authMock = vi.mocked(auth);
const createClientMock = vi.mocked(createClient);
const findByIdMock = vi.mocked(findById);
const removeMock = vi.mocked(remove);
const initial = { type: null, message: "" } as const;

describe("client action auth guard + delegation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await addClient(initial, new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("addClient delegates to the service when authenticated", async () => {
    authMock.mockResolvedValue({ user: {} } as never);
    createClientMock.mockResolvedValue({ type: "success", message: "ok" } as never);
    const res = await addClient(initial, new FormData());
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(res.type).toBe("success");
  });

  it("deleteClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await deleteClient(1);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteClient removes the client when authenticated", async () => {
    authMock.mockResolvedValue({ user: {} } as never);
    findByIdMock.mockResolvedValue({ id: 1, photoUrl: null } as never);
    removeMock.mockResolvedValue({ id: 1 } as never);
    await deleteClient(1);
    expect(removeMock).toHaveBeenCalledWith(1);
  });
});
