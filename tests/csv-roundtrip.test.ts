import { describe, it, expect, vi, beforeEach } from "vitest";

// F7 / the export -> Excel FR -> import round trip, per entity. Each test runs
// the REAL export route, rewrites its output the way Excel FR re-saves a plain
// "CSV" (";" separator, Windows-1252, dates JJ/MM/AAAA, decimal comma, the
// formula-guard apostrophe kept as text), then feeds the bytes to the REAL
// import action and compares what reaches the repository with the original
// values. Only the repositories, the session and the locale are mocked.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));
vi.mock("@/repository/clients", () => ({
  search: vi.fn(),
  create: vi.fn(),
  findByEmail: vi.fn(),
  findTrashState: vi.fn().mockResolvedValue({ inTrash: false }),
}));
vi.mock("@/repository/projects", () => ({ search: vi.fn(), create: vi.fn() }));
vi.mock("@/repository/contacts", () => ({ findAllWithClientEmail: vi.fn(), create: vi.fn() }));
vi.mock("@/repository/jobFunctions", () => ({ findAllOptions: vi.fn() }));
vi.mock("@/repository/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/repository/projectActivity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn() }));

import { GET as exportClients } from "@/app/clients/export/route";
import { GET as exportProjects } from "@/app/projects/export/route";
import { GET as exportContacts } from "@/app/clients/contacts/export/route";
import { importClients } from "@/actions/clients/clients";
import { importProjects } from "@/actions/projects/projects";
import { importContacts } from "@/actions/contacts/contacts";
import { auth } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/getLocale";
import { findAccessScopeByEmail } from "@/repository/users";
import { search as searchClients, create as createClientRow, findByEmail } from "@/repository/clients";
import { search as searchProjects, create as createProjectRow } from "@/repository/projects";
import { findAllWithClientEmail, create as createContactRow } from "@/repository/contacts";
import { findAllOptions } from "@/repository/jobFunctions";
import { parseCsv } from "@/lib/csv";
import { MAX_PHONE_LENGTH } from "@/schemas/fields";
import { accountWithoutFunction } from "./helpers/accessFixtures";

const authMock = vi.mocked(auth);
const getLocaleMock = vi.mocked(getLocale);

const BOM = "﻿";

/** Windows-1252 bytes of a string: what Excel writes for a plain "CSV" in a Western locale. */
function encodeWindows1252(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "€") bytes.push(0x80);
    else if (code <= 0xff) bytes.push(code);
    else throw new Error(`U+${code.toString(16)} is not representable in Windows-1252`);
  }
  return Uint8Array.from(bytes);
}

/**
 * What Excel FR does to a file it opened and saved again as "CSV": ";" as the
 * separator, quotes only where needed, no BOM, ISO dates shown (and saved) as
 * JJ/MM/AAAA, a decimal point turned into a comma (with a no-break thousands
 * space for a big number), the text cells / apostrophe included / untouched,
 * and the whole file in Windows-1252.
 */
function excelFrResave(exported: string, opts: { dateHeaders?: string[]; numberHeaders?: string[] } = {}): ArrayBuffer {
  const [header, ...rows] = parseCsv(exported);
  const quote = (cell: string) => (/[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const convert = (cell: string, name: string): string => {
    if (opts.dateHeaders?.includes(name)) {
      return cell.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_m, y: string, mo: string, d: string) => `${d}/${mo}/${y}`);
    }
    if (opts.numberHeaders?.includes(name) && /^\d+(\.\d+)?$/.test(cell)) {
      const [int, dec] = cell.split(".");
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return dec === undefined ? grouped : `${grouped},${dec}`;
    }
    return cell;
  };
  const lines = [header.map(quote).join(";"), ...rows.map((row) => row.map((cell, i) => quote(convert(cell, header[i]))).join(";"))];
  const bytes = encodeWindows1252(lines.join("\r\n") + "\r\n");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function exportText(response: Response): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
}

function formWith(bytes: ArrayBuffer): FormData {
  const fd = new FormData();
  fd.set("file", new File([bytes], "export.csv", { type: "text/csv" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
  vi.mocked(findAccessScopeByEmail).mockResolvedValue(accountWithoutFunction());
  getLocaleMock.mockResolvedValue("fr");
});

describe("export format by language", () => {
  const clientRow = {
    companyName: "Acme",
    email: "a@x.com",
    phone: "",
    website: "",
    status: "PROSPECT",
    address: "1 rue",
    city: "Lyon",
    zipCode: "69000",
    country: "France",
  };

  it("uses ';' for a French user, keeps the UTF-8 BOM and the header names", async () => {
    vi.mocked(searchClients).mockResolvedValue({ clients: [clientRow] } as never);
    const text = await exportText(await exportClients(new Request("http://localhost/clients/export")));
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.slice(1).split("\r\n")[0]).toBe(
      '"Company";"Email";"Phone";"Website";"Status";"Address";"City";"Zip Code";"Country"'
    );
  });

  it("uses ',' otherwise", async () => {
    getLocaleMock.mockResolvedValue("en");
    vi.mocked(searchClients).mockResolvedValue({ clients: [clientRow] } as never);
    const text = await exportText(await exportClients(new Request("http://localhost/clients/export")));
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.slice(1).split("\r\n")[0]).toBe(
      '"Company","Email","Phone","Website","Status","Address","City","Zip Code","Country"'
    );
  });
});

describe("clients: export -> Excel FR -> import", () => {
  it("returns the same values, accents, euro sign, ';' and +33 phone included", async () => {
    const full = {
      companyName: "Électricité Müller; Fils",
      email: "contact@muller.fr",
      phone: "+33 6 12 34 56 78",
      website: "https://muller.fr",
      status: "CLIENT",
      address: "12 rue de l'Église; bât. B / 5 000 €",
      city: "Besançon",
      zipCode: "25000",
      country: "France",
    };
    // The degenerate row: every optional field empty.
    const bare = { ...full, companyName: "Bare", email: "bare@x.fr", phone: null, website: null, status: "PROSPECT" };
    vi.mocked(searchClients).mockResolvedValue({ clients: [full, bare] } as never);
    vi.mocked(createClientRow).mockResolvedValue({ id: 1 } as never);

    const exported = await exportText(await exportClients(new Request("http://localhost/clients/export")));
    const res = await importClients(formWith(excelFrResave(exported)));

    expect(res.errors).toEqual([]);
    expect(res.created).toBe(2);
    const created = vi.mocked(createClientRow).mock.calls.map(([data]) => data);
    expect(created[0]).toMatchObject({ ...full });
    expect(created[1]).toMatchObject({ companyName: "Bare", email: "bare@x.fr", phone: null, website: null });
  });
});

describe("projects: export -> Excel FR -> import", () => {
  const client = { id: 5, email: "client@x.fr" };
  const base = {
    name: "Toiture Église; lot 2",
    businessNumber: "AFF-2026-1",
    type: "TOITURE",
    status: "EN_COURS",
    power: 12.5,
    budget: -500,
    address: "3 allée des Peupliers / 1 200 €",
    startDate: new Date("2026-06-15"),
    endDate: new Date("2026-12-31"),
    notes: "Prévoir l'échafaudage ; vérifier",
    client: { email: client.email },
  };

  it("returns the same values: negative budget, decimal comma, JJ/MM/AAAA dates, accents", async () => {
    const big = { ...base, name: "Grosse centrale", power: 1234.5, budget: 1234567.5 };
    // The degenerate row: no business number, power, budget, dates, notes.
    const bare = { ...base, name: "Sans détails", businessNumber: "", power: null, budget: null, startDate: null, endDate: null, address: "", notes: "" };
    vi.mocked(searchProjects).mockResolvedValue({ projects: [base, big, bare] } as never);
    vi.mocked(findByEmail).mockResolvedValue(client as never);
    vi.mocked(createProjectRow).mockResolvedValue({ id: 1 } as never);

    const exported = await exportText(await exportProjects(new Request("http://localhost/projects/export")));
    // The export itself guards the formula-looking cell with an apostrophe.
    expect(exported).toContain(`"'-500"`);
    const res = await importProjects(
      formWith(excelFrResave(exported, { dateHeaders: ["Start Date", "End Date"], numberHeaders: ["Power"] }))
    );

    expect(res.errors).toEqual([]);
    expect(res.created).toBe(3);
    const created = vi.mocked(createProjectRow).mock.calls.map(([data]) => data);
    expect(created[0]).toMatchObject({
      clientId: 5,
      name: base.name,
      businessNumber: "AFF-2026-1",
      type: "TOITURE",
      status: "EN_COURS",
      power: 12.5,
      budget: -500,
      address: base.address,
      startDate: "2026-06-15",
      endDate: "2026-12-31",
      notes: base.notes,
    });
    expect(created[1]).toMatchObject({ power: 1234.5, budget: 1234567.5 });
    expect(created[2]).toMatchObject({ name: "Sans détails", businessNumber: "", power: undefined, budget: undefined, startDate: undefined, endDate: undefined });
  });

  it("reads 03/04/2026 as the 3rd of April, never the 4th of March", async () => {
    const row = { ...base, startDate: new Date("2026-04-03"), endDate: new Date("2026-04-30") };
    vi.mocked(searchProjects).mockResolvedValue({ projects: [row] } as never);
    vi.mocked(findByEmail).mockResolvedValue(client as never);
    vi.mocked(createProjectRow).mockResolvedValue({ id: 1 } as never);
    const exported = await exportText(await exportProjects(new Request("http://localhost/projects/export")));
    await importProjects(formWith(excelFrResave(exported, { dateHeaders: ["Start Date", "End Date"] })));
    expect(vi.mocked(createProjectRow).mock.calls[0][0]).toMatchObject({ startDate: "2026-04-03", endDate: "2026-04-30" });
  });
});

describe("contacts: export -> Excel FR -> import", () => {
  // A phone at the ceiling that starts with "+": the export guards it with an
  // apostrophe (ceiling + 1 on the wire), the import must hand back exactly
  // MAX_PHONE_LENGTH characters.
  const phoneAtCeiling = "+".padEnd(MAX_PHONE_LENGTH, "1");
  const contact = {
    client: { email: "acme@x.fr" },
    firstName: "Zoé",
    lastName: "Lefèvre; Dupont",
    jobFunction: { name: "Électricien" },
    email: "zoe@x.fr",
    phone: "+33 6 12 34 56 78",
    isPrimary: true,
  };

  it("returns the same values, the role resolved by name, the ceiling-length phone intact", async () => {
    const atCeiling = { ...contact, firstName: "Max", phone: phoneAtCeiling, isPrimary: false };
    // The degenerate row: no role, e-mail or phone.
    const bare = { ...contact, firstName: "Vide", jobFunction: null, email: "", phone: null, isPrimary: false };
    vi.mocked(findAllWithClientEmail).mockResolvedValue([contact, atCeiling, bare] as never);
    vi.mocked(findByEmail).mockResolvedValue({ id: 9, email: "acme@x.fr" } as never);
    vi.mocked(findAllOptions).mockResolvedValue([{ id: 7, name: "Électricien" }] as never);
    vi.mocked(createContactRow).mockResolvedValue({ id: 1 } as never);

    const exported = await exportContacts();
    const text = await exportText(exported);
    expect(text).toContain(`"'${phoneAtCeiling}"`);
    expect(`'${phoneAtCeiling}`).toHaveLength(MAX_PHONE_LENGTH + 1);

    const res = await importContacts(formWith(excelFrResave(text)));

    expect(res.errors).toEqual([]);
    expect(res.created).toBe(3);
    const created = vi.mocked(createContactRow).mock.calls.map(([data]) => data);
    expect(created[0]).toMatchObject({
      clientId: 9,
      firstName: "Zoé",
      lastName: "Lefèvre; Dupont",
      jobFunctionId: 7,
      email: "zoe@x.fr",
      phone: "+33 6 12 34 56 78",
      isPrimary: true,
    });
    expect(created[1]).toMatchObject({ phone: phoneAtCeiling });
    expect(created[1].phone).toHaveLength(MAX_PHONE_LENGTH);
    expect(created[2]).toMatchObject({ firstName: "Vide", jobFunctionId: undefined, email: undefined, phone: undefined, isPrimary: false });
  });
});
