import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/service/clients", () => ({ createClient: vi.fn() }));
vi.mock("@/repository/activity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { importClients } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { createClient } from "@/service/clients";
import { logActivity } from "@/repository/activity";

const authMock = vi.mocked(auth);
const createClientMock = vi.mocked(createClient);
const logActivityMock = vi.mocked(logActivity);

const HEADER =
  '"Firstname","Lastname","Email","Company","Phone","Website","Status","Address","City","Zip Code","Country"';

function csvFile(rows: string[]): FormData {
  const fd = new FormData();
  const csv = [HEADER, ...rows].join("\r\n");
  fd.set("file", new File([csv], "clients.csv", { type: "text/csv" }));
  return fd;
}

describe("importClients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses without an ADMIN session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await importClients(csvFile(['"Alice","Smith","a@x.com","Acme","","","","1 St","NYC","10001","US"']));
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    const res = await importClients(new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a file with no data rows", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    const fd = new FormData();
    fd.set("file", new File([HEADER], "clients.csv", { type: "text/csv" }));
    const res = await importClients(fd);
    expect(res.type).toBe("error");
    expect(res.total).toBe(0);
  });

  it("imports every valid row and reports the created count", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    createClientMock.mockResolvedValue({ type: "success", message: "ok" } as never);

    const res = await importClients(
      csvFile([
        '"Alice","Smith","alice@x.com","Acme","","","","1 St","NYC","10001","US"',
        '"Bob","Jones","bob@x.com","Acme","","","","2 St","NYC","10001","US"',
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
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    createClientMock
      .mockResolvedValueOnce({ type: "success", message: "ok" } as never)
      .mockRejectedValueOnce({ type: "error", message: "A client with this email already exists." })
      .mockResolvedValueOnce({ type: "success", message: "ok" } as never);

    const res = await importClients(
      csvFile([
        '"Alice","Smith","alice@x.com","Acme","","","","1 St","NYC","10001","US"',
        '"Dup","Row","dup@x.com","Acme","","","","2 St","NYC","10001","US"',
        '"Bob","Jones","bob@x.com","Acme","","","","3 St","NYC","10001","US"',
      ])
    );

    expect(createClientMock).toHaveBeenCalledTimes(3);
    expect(res.created).toBe(2);
    expect(res.errors).toEqual([
      { row: 3, email: "dup@x.com", message: "A client with this email already exists." },
    ]);
  });

  it("omits a blank Status cell instead of passing an empty string", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN" } } as never);
    createClientMock.mockResolvedValue({ type: "success", message: "ok" } as never);

    await importClients(
      csvFile(['"Alice","Smith","alice@x.com","Acme","","","","1 St","NYC","10001","US"'])
    );

    const passed = createClientMock.mock.calls[0][0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("status");
    expect(passed.firstName).toBe("Alice");
  });
});
