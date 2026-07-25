import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/contacts", () => ({ create: vi.fn() }));
vi.mock("@/repository/clients", () => ({ findByEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { importContacts } from "@/actions/contacts/contacts";
import { auth } from "@/lib/auth";
import { create } from "@/repository/contacts";
import { findByEmail } from "@/repository/clients";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(create);
const findByEmailMock = vi.mocked(findByEmail);

const HEADER = '"Company Email","First name","Last name","Role","Email","Phone","Primary"';

function csvFile(rows: string[]): FormData {
  const fd = new FormData();
  const csv = [HEADER, ...rows].join("\r\n");
  fd.set("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  return fd;
}

describe("importContacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses without an ADMIN session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await importContacts(csvFile(['"acme@x.com","Alice","Smith","","","","",']));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    const res = await importContacts(new FormData());
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("links each row to its organisation by Company Email and creates the contact", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    findByEmailMock.mockResolvedValue({ id: 7 } as never);
    createMock.mockResolvedValue({} as never);

    const res = await importContacts(
      csvFile(['"acme@x.com","Alice","Smith","Directrice","alice@x.com","0102","true"'])
    );

    expect(res.created).toBe(1);
    expect(res.type).toBe("success");
    expect(findByEmailMock).toHaveBeenCalledWith("acme@x.com");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 7,
        firstName: "Alice",
        lastName: "Smith",
        role: "Directrice",
        email: "alice@x.com",
        phone: "0102",
        isPrimary: true,
      })
    );
  });

  it("reports a row whose Company Email matches no organisation", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    findByEmailMock.mockResolvedValue(null as never);

    const res = await importContacts(
      csvFile(['"ghost@x.com","Bob","Jones","","","",""'])
    );

    expect(res.created).toBe(0);
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ row: 2, email: "ghost@x.com" });
  });

  it("reports a row missing the Company Email without hitting the lookup", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    const res = await importContacts(csvFile(['"","Bob","Jones","","","",""']));

    expect(res.created).toBe(0);
    expect(findByEmailMock).not.toHaveBeenCalled();
    expect(res.errors).toHaveLength(1);
  });

  it("treats a blank Primary cell as non-primary", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    findByEmailMock.mockResolvedValue({ id: 7 } as never);
    createMock.mockResolvedValue({} as never);

    await importContacts(csvFile(['"acme@x.com","Alice","Smith","","","",""']));

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isPrimary: false }));
  });
});
