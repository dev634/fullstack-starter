import { MAX_IMPORT_BYTES, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, type CsvRefusal } from "@/lib/csv";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

/**
 * The result an importer returns when readCsvUpload refused the file: nothing
 * created, the user-facing reason in the active language. `emptyMessage` is
 * the importer's own wording for a file with no data row. `total` carries the
 * row count only for a file refused for its length, as the importers always did.
 */
export function csvRefusalResult(
  refusal: CsvRefusal,
  t: Dictionary,
  emptyMessage: string
): { type: "error"; message: string; created: 0; total: number; errors: [] } {
  switch (refusal.reason) {
    case "empty":
      return { type: "error", message: emptyMessage, created: 0, total: 0, errors: [] };
    case "tooLarge":
      return {
        type: "error",
        message: format(t.errors.uploadTooLarge, { max: MAX_IMPORT_BYTES / (1024 * 1024) }),
        created: 0,
        total: 0,
        errors: [],
      };
    case "tooManyColumns":
      return {
        type: "error",
        message: format(t.errors.tooManyColumns, { count: refusal.count, max: MAX_IMPORT_COLUMNS }),
        created: 0,
        total: 0,
        errors: [],
      };
    case "tooManyRows":
      return {
        type: "error",
        message: format(t.errors.tooManyRows, { count: refusal.count, max: MAX_IMPORT_ROWS }),
        created: 0,
        total: refusal.count,
        errors: [],
      };
  }
}
