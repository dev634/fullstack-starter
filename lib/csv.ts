import type { Locale } from "@/lib/i18n/locale";

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

/**
 * A cell csvCell guards: a formula trigger (= + - @ tab CR), possibly already
 * preceded by apostrophes. Counting the apostrophes keeps the guard a
 * bijection: "+x" -> "'+x" and a stored "'+x" -> "''+x", so unescapeCsvCell
 * can never confuse the two.
 */
const GUARDED_CELL = /^'*[=+\-@\t\r]/;
/** A cell carrying csvCell's guard: at least one apostrophe, then a trigger. */
const ESCAPED_CELL = /^'+[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let str = String(value ?? "");
  // Neutralise CSV formula injection: a cell starting with = + - @ (or a
  // leading tab/CR that spreadsheets strip before parsing) is treated as a
  // formula by Excel/Sheets. Prefix with a single quote so it stays text.
  if (GUARDED_CELL.test(str)) {
    str = "'" + str;
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * The exact inverse of csvCell's injection guard: removes ONE leading
 * apostrophe, and only when the leading apostrophes are followed by one of the
 * characters csvCell protects (= + - @ tab CR) — "'+33 6 12" becomes
 * "+33 6 12", but "'Alice" and "l'été" are returned untouched. Without it a
 * phone number exported as "'+33…" came back with its apostrophe, and a budget
 * "'-500" was not a number. unescapeCsvCell(guarded(x)) === x for every x.
 */
export function unescapeCsvCell(value: string): string {
  return ESCAPED_CELL.test(value) ? value.slice(1) : value;
}

/**
 * Field separator of an export for a given UI language. Excel in French
 * expects ";" (the comma is its decimal separator, so a comma-separated file
 * opens as a single column); everyone else gets ",".
 */
export function csvDelimiterForLocale(locale: Locale): string {
  return locale === "fr" ? ";" : ",";
}

/** One CSV record: every cell through csvCell, joined with the delimiter. */
export function csvLine(cells: unknown[], delimiter: string): string {
  return cells.map(csvCell).join(delimiter);
}

/**
 * A whole CSV document: UTF-8 BOM (so Excel reads the accents), then the
 * header and the rows, CRLF-separated. Shared by the three exports.
 */
export function buildCsv(header: unknown[], rows: unknown[][], delimiter: string): string {
  return "﻿" + [csvLine(header, delimiter), ...rows.map((row) => csvLine(row, delimiter))].join("\r\n");
}

/**
 * Decode an uploaded CSV. Tries strict UTF-8 first (our own export, Excel's
 * "CSV UTF-8"); on invalid UTF-8 falls back to Windows-1252, which is what
 * Excel writes for a plain "CSV" in a Western locale — decoding that as UTF-8
 * silently turned every é and € into U+FFFD. A BOM is dropped by the decoder.
 */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Field separator of a file: ";" or "," according to which one the header
 * line (outside quotes) uses. Unambiguous because the header names contain
 * neither; a header with neither (one column) reads as ",".
 */
export function detectCsvDelimiter(text: string): string {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char === ",") commas++;
    else if (!inQuotes && char === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/**
 * Minimal RFC4180-ish CSV parser: handles quoted fields (with embedded
 * separators/newlines) and doubled-quote escaping ("" -> "). The separator is
 * detected from the header line (";" or ","), so a file re-saved by Excel FR
 * reads like our own export.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present (our own export prepends one for Excel).
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectCsvDelimiter(input);

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
    } else if (char === delimiter) {
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
 * (trimmed) header names. Values are trimmed and have csvCell's formula guard
 * undone (unescapeCsvCell) — every importer wants the value as the user
 * originally stored it.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = unescapeCsvCell((row[i] ?? "").trim());
    });
    return record;
  });
}

/** The header text a column key is exported under; throws on an unknown key so a drifted import fails loudly. */
export function csvHeaderOf(columns: { key: string; header: string }[], key: string): string {
  const column = columns.find((c) => c.key === key);
  if (!column) throw new Error("Unknown CSV column: " + key);
  return column.header;
}

/**
 * A date cell as Excel FR may have rewritten it: "AAAA-MM-JJ" is kept,
 * "JJ/MM/AAAA" (day first — never read as month-first, "03/04/2026" is the
 * 3rd of April) becomes "AAAA-MM-JJ". Anything else is returned unchanged so
 * the schema, which validates strictly, refuses it.
 */
export function normalizeCsvDate(value: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : value;
}

/**
 * A number cell as Excel FR may have rewritten it: decimal comma ("12,5") and
 * thousands spaces, including no-break (U+00A0) and narrow no-break (U+202F)
 * ones ("1 234,5"). When both "," and "." appear, the LAST one is the decimal
 * mark; several commas can only be thousands separators. Returns a string
 * Number() understands, or the input (spaces removed) when it is not one.
 */
export function normalizeCsvNumber(value: string): string {
  const compact = value.replace(/[\s  ]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  if (lastComma === -1) return compact;
  if (lastDot > lastComma) return compact.replace(/,/g, "");
  if (compact.indexOf(",") !== lastComma) return compact.replace(/,/g, "");
  return compact.replace(/\./g, "").replace(",", ".");
}
