/**
 * Row-count ceiling shared by every CSV import (clients, projects, contacts —
 * adversarial pass 2, point 7). Before this, the only real limit was the
 * Server Action body-size cap (10 MB, next.config.ts's bodySizeLimit) — for
 * a short CSV row that's ~170 000 lines, and each row costs up to three
 * sequential repository calls (a lookup, a scope check, a create), never
 * batched. Measured: 2000 lines took 8.7s on the heaviest import path — a
 * Server Action holding a database connection open for minutes on a large
 * file is a resource-exhaustion vector, not just a slow request. 1000 keeps
 * a worst-case import within a few seconds (~4.35 ms/row measured × 1000),
 * comfortably above any real bulk import (a legitimate export/edit/re-import
 * round trip), and each importer reports the ones it can't process rather
 * than silently truncating the file.
 */
export const MAX_IMPORT_ROWS = 1000;

/**
 * Single source of truth for the CSV column headers used by both
 * /clients/export and the CSV import — keeps the two round-trip compatible.
 */
export const CLIENT_CSV_COLUMNS: { key: string; header: string }[] = [
  { key: "companyName", header: "Company" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "website", header: "Website" },
  { key: "status", header: "Status" },
  { key: "address", header: "Address" },
  { key: "city", header: "City" },
  { key: "zipCode", header: "Zip Code" },
  { key: "country", header: "Country" },
];

/**
 * Columns for /clients/contacts/export and the contacts CSV import.
 * `companyEmail` is a virtual column (not a Contact field) used to look up the
 * owning organisation on import, since a contact can't exist without one.
 */
export const CONTACT_CSV_COLUMNS: { key: string; header: string }[] = [
  { key: "companyEmail", header: "Company Email" },
  { key: "firstName", header: "First name" },
  { key: "lastName", header: "Last name" },
  { key: "role", header: "Role" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "isPrimary", header: "Primary" },
];

/**
 * Same idea as CLIENT_CSV_COLUMNS, for /projects/export and its CSV import.
 * `clientEmail` is a virtual column (not a Project field) used to look up
 * the owning client on import, since a project can't exist without one.
 */
export const PROJECT_CSV_COLUMNS: { key: string; header: string }[] = [
  { key: "name", header: "Name" },
  { key: "businessNumber", header: "Business Number" },
  { key: "clientEmail", header: "Client Email" },
  { key: "type", header: "Type" },
  { key: "status", header: "Status" },
  { key: "power", header: "Power" },
  { key: "budget", header: "Budget" },
  { key: "address", header: "Address" },
  { key: "startDate", header: "Start Date" },
  { key: "endDate", header: "End Date" },
  { key: "notes", header: "Notes" },
];

export function csvCell(value: unknown): string {
  let str = String(value ?? "");
  // Neutralise CSV formula injection: a cell starting with = + - @ (or a
  // leading tab/CR that spreadsheets strip before parsing) is treated as a
  // formula by Excel/Sheets. Prefix with a single quote so it stays text.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Minimal RFC4180-ish CSV parser: handles quoted fields (with embedded
 * commas/newlines) and doubled-quote escaping ("" -> "). Good enough to
 * round-trip the app's own /clients/export output.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present (our own export prepends one for Excel).
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Parse a CSV with a header row into an array of objects keyed by the
 * (trimmed) header names.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (row[i] ?? "").trim();
    });
    return record;
  });
}
