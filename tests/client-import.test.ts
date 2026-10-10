import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/service/clients", () => ({ createClient: vi.fn() }));
vi.mock("@/repository/activity", () => ({ logActivity: vi.fn() }));
// requireAreaAccess("clients") (via getAccessContext) now resolves "no
// account" to DENIED rather than "unrestricted" — this file's ADMIN fixtures
// carry a real email (see `actor` below) and need their scope resolved to a
// real, existing account with no job function, or every one of them would be
// refused at the area gate before ever reaching importClients' own logic.
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { importClients } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { createClient } from "@/service/clients";
import { logActivity } from "@/repository/activity";
import { findAccessScopeByEmail } from "@/repository/users";
import { MAX_IMPORT_ROWS } from "@/lib/csv";

const authMock = vi.mocked(auth);
const createClientMock = vi.mocked(createClient);
const logActivityMock = vi.mocked(logActivity);
const findAccessScopeByEmailMock = vi.mocked(findAccessScopeByEmail);

/** A real ADMIN session — every fixture below needs the email: getAccessContext
 * now resolves a session with no email to DENIED, not "unrestricted". */
function adminSession() {
  return { user: { role: "ADMIN", email: "admin@example.com" } } as never;
}

const HEADER =
  '"Company","Email","Phone","Website","Status","Address","City","Zip Code","Country"';

function csvFile(rows: string[]): FormData {
  const fd = new FormData();
  const csv = [HEADER, ...rows].join("\r\n");
  fd.set("file", new File([csv], "clients.csv", { type: "text/csv" }));
  return fd;
}

describe("importClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAccessScopeByEmailMock.mockResolvedValue({
      hiddenSections: [],
      hiddenAreas: [],
      projectScope: "ALL",
      assignedProjectIds: [],
    });
  });

  it("refuses without an ADMIN session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await importClients(csvFile(['"Acme","a@x.com","","","","1 St","NYC","10001","US"']));
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    authMock.mockResolvedValue(adminSession());
    const res = await importClients(new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  // Adversarial pass 2, point 7: no row-count limit existed before this —
  // the only real ceiling was the 10 MB Server Action body cap (~170 000
  // rows for a short CSV row), each costing its own createClient call.
  it("rejects a file over MAX_IMPORT_ROWS without creating anything", async () => {
    authMock.mockResolvedValue(adminSession());
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `"Acme","a${i}@x.com","","","","1 St","NYC","10001","US"`
    );
    const res = await importClients(csvFile(rows));
    expect(res.type).toBe("error");
    expect(res.total).toBe(MAX_IMPORT_ROWS + 1);
    expect(res.created).toBe(0);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a file with no data rows", async () => {
    authMock.mockResolvedValue(adminSession());
    const fd = new FormData();
    fd.set("file", new File([HEADER], "clients.csv", { type: "text/csv" }));
    const res = await importClients(fd);
    expect(res.type).toBe("error");
    expect(res.total).toBe(0);
  });

  it("imports every valid row and reports the created count", async () => {
    authMock.mockResolvedValue(adminSession());
    createClientMock.mockResolvedValue({ type: "success", message: "ok" } as never);

    const res = await importClients(
      csvFile([
        '"Acme","alice@x.com","","","","1 St","NYC","10001","US"',
        '"Acme","bob@x.com","","","","2 St","NYC","10001","US"',
      ])
    );

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(res.created).toBe(2);
    expect(res.total).toBe(2);
    expect(res.errors).toHaveLength(0);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "IMPORTED", clientId: null })
    );
  });

  it("keeps processing after a row fails and reports it with its row number", async () => {
    authMock.mockResolvedValue(adminSession());
    createClientMock
      .mockResolvedValueOnce({ type: "success", message: "ok" } as never)
      .mockRejectedValueOnce({ type: "error", message: "A client with this email already exists." })
      .mockResolvedValueOnce({ type: "success", message: "ok" } as never);

    const res = await importClients(
      csvFile([
        '"Acme","alice@x.com","","","","1 St","NYC","10001","US"',
        '"Acme","dup@x.com","","","","2 St","NYC","10001","US"',
        '"Acme","bob@x.com","","","","3 St","NYC","10001","US"',
      ])
    );

    expect(createClientMock).toHaveBeenCalledTimes(3);
    expect(res.created).toBe(2);
    expect(res.errors).toEqual([
      { row: 3, email: "dup@x.com", message: "A client with this email already exists." },
    ]);
  });

  it("omits a blank Status cell instead of passing an empty string", async () => {
    authMock.mockResolvedValue(adminSession());
    createClientMock.mockResolvedValue({ type: "success", message: "ok" } as never);

    await importClients(
      csvFile(['"Acme","alice@x.com","","","","1 St","NYC","10001","US"'])
    );

    const passed = createClientMock.mock.calls[0][0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("status");
    expect(passed.companyName).toBe("Acme");
  });
});
