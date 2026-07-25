import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({
  create: vi.fn(),
  updateProfile: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn(),
  countSuperadmins: vi.fn(),
  updatePassword: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { addUser, updateUser, deleteUser } from "@/actions/users/users";
import { auth } from "@/lib/auth";
import { create, updateProfile, remove, findById, countSuperadmins } from "@/repository/users";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(create);
const updateProfileMock = vi.mocked(updateProfile);
const removeMock = vi.mocked(remove);
const findByIdMock = vi.mocked(findById);
const countSuperMock = vi.mocked(countSuperadmins);
const initial = { type: null, message: "" } as const;

function actor(role: string, email = `${role.toLowerCase()}@x.com`) {
  authMock.mockResolvedValue({ user: { role, email } } as never);
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("user management actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addUser refuses a non-ADMIN", async () => {
    actor("EDITOR");
    const res = await addUser(initial, form({ email: "n@x.com", role: "VIEWER", password: "password123" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addUser: an ADMIN cannot grant SUPERADMIN", async () => {
    actor("ADMIN");
    const res = await addUser(initial, form({ email: "n@x.com", role: "SUPERADMIN", password: "password123" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addUser: an ADMIN adds an EDITOR with a hashed password", async () => {
    actor("ADMIN");
    createMock.mockResolvedValue({ id: 5 } as never);
    const res = await addUser(initial, form({ email: "ed@x.com", name: "Ed", role: "EDITOR", password: "password123" }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ed@x.com", name: "Ed", role: "EDITOR", password: "hashed" })
    );
  });

  it("updateUser: an ADMIN cannot manage a SUPERADMIN", async () => {
    actor("ADMIN");
    findByIdMock.mockResolvedValue({ id: 9, email: "s@x.com", role: "SUPERADMIN" } as never);
    const res = await updateUser(initial, form({ id: "9", role: "ADMIN" }));
    expect(res.type).toBe("error");
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("updateUser: cannot demote the last SUPERADMIN", async () => {
    actor("SUPERADMIN");
    findByIdMock.mockResolvedValue({ id: 3, email: "s@x.com", role: "SUPERADMIN" } as never);
    countSuperMock.mockResolvedValue(1 as never);
    const res = await updateUser(initial, form({ id: "3", role: "ADMIN" }));
    expect(res.type).toBe("error");
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("deleteUser: cannot delete your own account", async () => {
    actor("ADMIN", "me@x.com");
    findByIdMock.mockResolvedValue({ id: 1, email: "me@x.com", role: "ADMIN" } as never);
    const res = await deleteUser(1);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteUser: cannot delete the last SUPERADMIN", async () => {
    actor("SUPERADMIN", "boss@x.com");
    findByIdMock.mockResolvedValue({ id: 2, email: "other@x.com", role: "SUPERADMIN" } as never);
    countSuperMock.mockResolvedValue(1 as never);
    const res = await deleteUser(2);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteUser: an ADMIN deletes a VIEWER", async () => {
    actor("ADMIN", "me@x.com");
    findByIdMock.mockResolvedValue({ id: 7, email: "v@x.com", role: "VIEWER" } as never);
    removeMock.mockResolvedValue({ id: 7 } as never);
    const res = await deleteUser(7);
    expect((res as { type: string }).type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(7);
  });
});
