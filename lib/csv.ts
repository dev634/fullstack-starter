import type { Locale } from "@/lib/i18n/locale";

/**
 * Row-count ceiling shared by every CSV import (clients, projects, contacts —
 * adversarial pass 2, point 7). Before this, the only real limit was the
 * Server Action body-size cap (25 MB, next.config.ts's bodySizeLimit) — for
 * a short CSV row that's ~600 000 lines, and each row costs up to three
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
 * Byte ceiling of an uploaded CSV, checked on `file.size` BEFORE the file is
 * read into memory. Calibrated on the widest real entity, a project, with
 * every field at its schema ceiling: name 200 + business number 40 + client
 * e-mail 254 + type 15 + status 12 + power 24 + budget 24 + address 300 +
 * two dates 20 + notes 5000 = 5889 characters, plus ~35 for quotes,
 * separators and the CRLF = ~5.9 KB per row in ASCII. × MAX_IMPORT_ROWS =
 * ~5.9 MB. 8 MiB leaves ~40 % for multi-byte UTF-8 (accents, €) and doubled
 * quotes. It is far below the Server Action body cap (25 MB), so that cap is
 * never the effective limit of an import.
 */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/**
 * Column ceiling of an imported file's header. The widest import table is
 * PROJECT_CSV_COLUMNS (11 columns); 40 leaves room for the extra columns a
 * spreadsheet adds (the importers ignore unknown headers) while a header of
 * 100 000 names is refused. The cap exists because every data row is turned
 * into an object carrying ALL the header's columns: rows × columns entries.
 */
export const MAX_IMPORT_COLUMNS = 40;

/** A CSV column table: the field key and the header it is exported under. */
export type CsvColumns = readonly { readonly key: string; readonly header: string }[];

/**
 * Field separator of a CSV file. It also tells which conventions the file's
 * numbers and dates follow: ";" is Excel FR's, "," everyone else's — see
 * normalizeCsvNumber / normalizeCsvDate.
 */
export type CsvDelimiter = ";" | ",";

/**
 * Single source of truth for the CSV column headers used by both
 * /clients/export and the CSV import — keeps the two round-trip compatible.
 */
export const CLIENT_CSV_COLUMNS = [
  { key: "companyName", header: "Company" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "website", header: "Website" },
  { key: "status", header: "Status" },
  { key: "address", header: "Address" },
  { key: "city", header: "City" },
  { key: "zipCode", header: "Zip Code" },
  { key: "country", header: "Country" },
] as const satisfies CsvColumns;

/**
 * Columns for /clients/contacts/export and the contacts CSV import.
 * `companyEmail` is a virtual column (not a Contact field) used to look up the
 * owning organisation on import, since a contact can't exist without one.
 */
export const CONTACT_CSV_COLUMNS = [
  { key: "companyEmail", header: "Company Email" },
  { key: "firstName", header: "First name" },
  { key: "lastName", header: "Last name" },
  { key: "role", header: "Role" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "isPrimary", header: "Primary" },
] as const satisfies CsvColumns;

/**
 * Same idea as CLIENT_CSV_COLUMNS, for /projects/export and its CSV import.
 * `clientEmail` is a virtual column (not a Project field) used to look up
 * the owning client on import, since a project can't exist without one.
 */
export const PROJECT_CSV_COLUMNS = [
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
] as const satisfies CsvColumns;

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
export function csvDelimiterForLocale(locale: Locale): CsvDelimiter {
  return locale === "fr" ? ";" : ",";
}

const CRLF = "\r\n";
/** UTF-8 byte-order mark: what makes Excel read the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/**
 * A whole CSV document: UTF-8 BOM (so Excel reads the accents), then the
 * header and the rows, every cell through csvCell, CRLF-separated.
 */
export function buildCsv(header: unknown[], rows: unknown[][], delimiter: CsvDelimiter): string {
  return BOM + [header, ...rows].map((cells) => cells.map(csvCell).join(delimiter)).join(CRLF);
}

/**
 * The download response of an export: the rows (one record per row, keyed by
 * the columns' `key`) under the columns' headers, separated for the user's
 * language (";" for a French user, Excel FR; "," otherwise). Shared by the
 * three exports.
 */
export function csvResponse(columns: CsvColumns, rows: Record<string, unknown>[], filename: string, locale: Locale): Response {
  const csv = buildCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((c) => row[c.key])),
    csvDelimiterForLocale(locale)
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
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

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Field separator of a file: ";" or "," according to which one the header
 * line (outside quotes) uses. Unambiguous because the header names contain
 * neither; a header with neither (one column) reads as ",". Leading blank
 * lines (and lines holding only separators, which parseCsv drops too) are
 * skipped: the header is the first line with content.
 */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  const input = stripBom(text);
  let inQuotes = false;
  let hasContent = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      if (hasContent) break;
      commas = 0;
      semicolons = 0;
    } else if (!inQuotes && char === ",") {
      commas++;
    } else if (!inQuotes && char === ";") {
      semicolons++;
    } else if (!/\s/.test(char)) {
      hasContent = true;
    }
  }
  return semicolons > commas ? ";" : ",";
}

/**
 * Splits CSV text into rows (RFC4180-ish: quoted fields with embedded
 * separators/newlines, doubled-quote escaping "" -> "). Blank rows are
 * dropped. At most `keep` rows are RETURNED, but `rowCount` counts every
 * non-blank row of the text, so a caller can refuse a file for its length
 * without having materialised it.
 */
function scanCsv(input: string, delimiter: CsvDelimiter, keep: number): { rows: string[][]; rowCount: number } {
  const rows: string[][] = [];
  let rowCount = 0;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const commit = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) {
      rowCount++;
      if (rows.length < keep) rows.push(row);
    }
    row = [];
    field = "";
  };

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
      commit();
    } else {
      field += char;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) commit();

  return { rows, rowCount };
}

/**
 * Minimal CSV parser. The separator is detected from the header line (";" or
 * ","), so a file re-saved by Excel FR reads like our own export. A UTF-8 BOM
 * (our own export prepends one for Excel) is stripped.
 */
export function parseCsv(text: string): string[][] {
  const input = stripBom(text);
  return scanCsv(input, detectCsvDelimiter(input), Infinity).rows;
}

/**
 * One object per data row, keyed by the (trimmed) header names. Values are
 * trimmed and have csvCell's formula guard undone (unescapeCsvCell) — every
 * importer wants the value as the user originally stored it. Each record
 * carries ALL the header's columns, so the cost is rows × columns: callers
 * bound both BEFORE calling this (see parseCsvImport).
 */
function recordsOf(headers: string[], dataRows: string[][]): Record<string, string>[] {
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = unescapeCsvCell((row[i] ?? "").trim());
    });
    return record;
  });
}

/** parseCsv with a header row, into records. Unbounded: imports go through parseCsvImport. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  return recordsOf(
    rows[0].map((h) => h.trim()),
    rows.slice(1)
  );
}

/** Why an import file was refused before any record was built; `count` is the offending number. */
export type CsvRefusal =
  | { reason: "tooLarge" }
  | { reason: "empty" }
  | { reason: "tooManyColumns"; count: number }
  | { reason: "tooManyRows"; count: number };

export type CsvImport =
  | { ok: true; records: Record<string, string>[]; delimiter: CsvDelimiter }
  | ({ ok: false } & CsvRefusal);

/**
 * Parses the text of an import file into records, refusing it BEFORE building
 * them when it is too wide (MAX_IMPORT_COLUMNS) or too long (MAX_IMPORT_ROWS):
 * the records cost rows × columns, which no later check can undo. The
 * delimiter comes back with the records — it decides how the importer reads
 * numbers and dates. A file with a header and no data row is "empty", like
 * one with nothing at all.
 */
export function parseCsvImport(text: string): CsvImport {
  const input = stripBom(text);
  const delimiter = detectCsvDelimiter(input);
  const { rows, rowCount } = scanCsv(input, delimiter, MAX_IMPORT_ROWS + 1);
  if (rowCount <= 1) return { ok: false, reason: "empty" };
  const headers = rows[0].map((h) => h.trim());
  if (headers.length > MAX_IMPORT_COLUMNS) return { ok: false, reason: "tooManyColumns", count: headers.length };
  if (rowCount - 1 > MAX_IMPORT_ROWS) return { ok: false, reason: "tooManyRows", count: rowCount - 1 };
  return { ok: true, records: recordsOf(headers, rows.slice(1)), delimiter };
}

/**
 * Reads an uploaded CSV for import: the byte ceiling on `file.size` first
 * (before the file is read into memory), then decoding, then parseCsvImport.
 */
export async function readCsvUpload(file: File): Promise<CsvImport> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, reason: "tooLarge" };
  return parseCsvImport(decodeCsvBytes(await file.arrayBuffer()));
}

/**
 * The header text a column key is exported under. The key is typed on the
 * table's own keys, so a typo is a compile error; the throw only covers a
 * table that was widened to `CsvColumns`.
 */
export function csvHeaderOf<const C extends CsvColumns>(columns: C, key: C[number]["key"]): string {
  const column = columns.find((c) => c.key === key);
  if (!column) throw new Error("Unknown CSV column: " + key);
  return column.header;
}

/**
 * A date cell of an import file. A ";" file follows Excel FR: "JJ/MM/AAAA"
 * (day first — "03/04/2026" is the 3rd of April) becomes "AAAA-MM-JJ". A ","
 * file follows the English conventions, where "03/04/2026" would be the 4th of
 * March: a slashed date is ambiguous there and is NOT converted. "AAAA-MM-JJ"
 * passes in both. Anything not understood is returned unchanged, so the
 * schema — which validates strictly — refuses it instead of storing a guess.
 */
export function normalizeCsvDate(value: string, delimiter: CsvDelimiter): string {
  if (delimiter !== ";") return value;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : value;
}

/** A plain number as Number() reads it, and as our own export writes it ("1234.5"). */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** French: decimal comma, optional dotted thousands only when the comma is there to settle which mark is which. */
const FR_NUMBER = /^-?(\d+|\d{1,3}(\.\d{3})+),\d+$/;
/** English: comma only as a thousands separator, in groups of exactly three. */
const EN_GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * A number cell of an import file, brought back to a string Number() reads.
 * The convention follows the file's delimiter, because "1,234" is 1.234 in
 * one and 1234 in the other:
 * - ";" (Excel FR): decimal comma ("12,5"), thousands spaces including
 *   no-break (U+00A0) and narrow no-break (U+202F) ("1 234,5"); a plain
 *   "12.5" is kept (our own export writes that).
 * - "," (English): decimal point; a comma is accepted only as a thousands
 *   separator grouped by three ("15,000", "1,234.5"). "12,5" and "1,234,5" are
 *   not numbers there.
 * Anything not understood is returned UNCHANGED so the schema refuses it
 * instead of storing a wrong value.
 */
export function normalizeCsvNumber(value: string, delimiter: CsvDelimiter): string {
  if (delimiter === ";") {
    const compact = value.replace(/\s/g, "");
    if (PLAIN_NUMBER.test(compact)) return compact;
    if (FR_NUMBER.test(compact)) return compact.replace(/\./g, "").replace(",", ".");
    return value;
  }
  const trimmed = value.trim();
  if (PLAIN_NUMBER.test(trimmed)) return trimmed;
  if (EN_GROUPED_NUMBER.test(trimmed)) return trimmed.replace(/,/g, "");
  return value;
}
