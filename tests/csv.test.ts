import { describe, it, expect, vi } from "vitest";
import {
  parseCsv,
  parseCsvRecords,
  csvCell,
  unescapeCsvCell,
  decodeCsvBytes,
  detectCsvDelimiter,
  csvDelimiterForLocale,
  buildCsv,
  normalizeCsvDate,
  normalizeCsvNumber,
  csvHeaderOf,
  csvResponse,
  parseCsvImport,
  readCsvUpload,
  CLIENT_CSV_COLUMNS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
} from "@/lib/csv";

describe("csvCell", () => {
  it("quotes a plain value and escapes embedded quotes", () => {
    expect(csvCell("Alice")).toBe('"Alice"');
    expect(csvCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it("renders null/undefined as an empty quoted cell", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("neutralises formula-injection payloads with a leading apostrophe", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+SUM(A1)")).toBe(`"'+SUM(A1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell("\t=evil")).toBe(`"'\t=evil"`);
  });

  it("guards a value that already starts with apostrophes before a trigger, so the guard stays reversible", () => {
    expect(csvCell("'+x")).toBe(`"''+x"`);
  });

  it("leaves a formula character in the middle of a value untouched", () => {
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell("3-2")).toBe('"3-2"');
  });
});

describe("parseCsv", () => {
  it("parses simple quoted rows", () => {
    const csv = '"a","b","c"\r\n"1","2","3"';
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a comma embedded in a quoted field", () => {
    const csv = '"Smith, Alice","alice@example.com"';
    expect(parseCsv(csv)).toEqual([["Smith, Alice", "alice@example.com"]]);
  });

  it("unescapes doubled quotes", () => {
    const csv = '"She said ""hi""","ok"';
    expect(parseCsv(csv)).toEqual([['She said "hi"', "ok"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const csv = "﻿\"a\",\"b\"";
    expect(parseCsv(csv)).toEqual([["a", "b"]]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\r\n\r\n")).toEqual([]);
  });
});

describe("parseCsvRecords", () => {
  it("maps rows to objects keyed by the header row", () => {
    const csv = '"Firstname","Email"\r\n"Alice","alice@example.com"\r\n"Bob","bob@example.com"';
    expect(parseCsvRecords(csv)).toEqual([
      { Firstname: "Alice", Email: "alice@example.com" },
      { Firstname: "Bob", Email: "bob@example.com" },
    ]);
  });

  it("returns an empty array when there is no header row", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});

describe("unescapeCsvCell — the reciprocal of csvCell's formula guard", () => {
  const body = (value: string) => csvCell(value).slice(1, -1).replace(/""/g, '"');

  it.each(["=1+1", "+33 6 12 34 56 78", "-500", "@cmd", "\t=evil", "\r+x", "'+already quoted", "plain", "l'été", "'Alice", "", "'"])(
    "unescapeCsvCell(guarded(%j)) gives the original back",
    (value) => {
      expect(unescapeCsvCell(body(value))).toBe(value);
    }
  );

  it("removes exactly one apostrophe, and only before = + - @ tab CR", () => {
    expect(unescapeCsvCell("'+33")).toBe("+33");
    expect(unescapeCsvCell("''+33")).toBe("'+33");
    expect(unescapeCsvCell("'Alice")).toBe("'Alice");
    expect(unescapeCsvCell("'1")).toBe("'1");
    expect(unescapeCsvCell("'")).toBe("'");
    expect(unescapeCsvCell("+33")).toBe("+33");
  });

  it("parseCsvRecords applies it to values, not to header names", () => {
    expect(parseCsvRecords(`"Phone","Budget"\r\n"'+33 6","'-500"`)).toEqual([{ Phone: "+33 6", Budget: "-500" }]);
  });
});

describe("decodeCsvBytes", () => {
  it("reads UTF-8, dropping a BOM", () => {
    const bytes = new TextEncoder().encode("﻿Élec €");
    expect(decodeCsvBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)).toBe("Élec €");
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    // "Élec 5 € é" as Excel FR saves it: É=0xC9, €=0x80, é=0xE9
    const bytes = Uint8Array.from([0xc9, 0x6c, 0x65, 0x63, 0x20, 0x35, 0x20, 0x80, 0x20, 0xe9]);
    expect(decodeCsvBytes(bytes.buffer)).toBe("Élec 5 € é");
  });
});

describe("delimiter", () => {
  it("is detected from the header line, outside quotes", () => {
    expect(detectCsvDelimiter('"a";"b";"c"\r\n"1";"2";"3"')).toBe(";");
    expect(detectCsvDelimiter('"a","b","c"\r\n"1;1","2","3"')).toBe(",");
    expect(detectCsvDelimiter("a;b;c\n1,5;2;3")).toBe(";");
    expect(detectCsvDelimiter('"a;b","c"')).toBe(",");
    // Leading blank lines are skipped: the header is the first line with content.
    expect(detectCsvDelimiter("\r\nName;Email\r\na;b")).toBe(";");
    expect(detectCsvDelimiter("\n\n  \nName;Email")).toBe(";");
    expect(detectCsvDelimiter(";;;\r\nName;Email")).toBe(";");
    expect(detectCsvDelimiter("single")).toBe(",");
    expect(detectCsvDelimiter("﻿a;b")).toBe(";");
  });

  it("parseCsv reads a ';' file, quoted ';' and decimal commas intact", () => {
    expect(parseCsv('Name;Budget\r\n"Müller; Fils";1234,5\r\n')).toEqual([
      ["Name", "Budget"],
      ["Müller; Fils", "1234,5"],
    ]);
  });

  it("is ';' for French and ',' otherwise on export", () => {
    expect(csvDelimiterForLocale("fr")).toBe(";");
    expect(csvDelimiterForLocale("en")).toBe(",");
  });

  it("buildCsv prepends the BOM and joins with the delimiter", () => {
    expect(buildCsv(["A", "B"], [["x", "+1"]], ";")).toBe('﻿"A";"B"\r\n"x";"\'+1"');
  });
});

describe("normalizeCsvDate: the convention follows the file's delimiter", () => {
  it('a ";" file (Excel FR) reads JJ/MM/AAAA day-first and leaves everything else alone', () => {
    expect(normalizeCsvDate("15/06/2026", ";")).toBe("2026-06-15");
    expect(normalizeCsvDate("03/04/2026", ";")).toBe("2026-04-03"); // the 3rd of April
    expect(normalizeCsvDate("3/4/2026", ";")).toBe("2026-04-03");
    expect(normalizeCsvDate("2026-06-15", ";")).toBe("2026-06-15");
    expect(normalizeCsvDate("", ";")).toBe("");
    expect(normalizeCsvDate("June 15", ";")).toBe("June 15");
    expect(normalizeCsvDate("15/06/26", ";")).toBe("15/06/26");
  });

  it('a "," file: a slashed date is ambiguous (4 March or 3 April) and is refused, never guessed', () => {
    expect(normalizeCsvDate("3/4/2026", ",")).toBe("3/4/2026");
    expect(normalizeCsvDate("03/04/2026", ",")).toBe("03/04/2026");
    expect(normalizeCsvDate("15/06/2026", ",")).toBe("15/06/2026");
    expect(normalizeCsvDate("2026-04-03", ",")).toBe("2026-04-03");
    expect(normalizeCsvDate("", ",")).toBe("");
  });
});

describe("normalizeCsvNumber: the convention follows the file's delimiter", () => {
  it.each([
    ["12,5", "12.5"],
    ["12.5", "12.5"],
    ["-500", "-500"],
    ["-1 234,5", "-1234.5"],
    ["1 234,5", "1234.5"],
    ["1 234,5", "1234.5"], // no-break space
    ["1 234,5", "1234.5"], // narrow no-break space
    ["1 234 567,5", "1234567.5"],
    ["1.234,5", "1234.5"],
    ["1,234", "1.234"], // a decimal comma, not a thousand
    ["", ""],
    ["abc", "abc"],
    // English notations are not French: handed back unchanged, so the schema refuses them.
    ["1,234.5", "1,234.5"],
    ["1,234,567", "1,234,567"],
    ["1,234,5", "1,234,5"],
  ])('";" file: %j -> %j', (input, expected) => {
    expect(normalizeCsvNumber(input, ";")).toBe(expected);
  });

  it.each([
    ["15,000", "15000"],
    ["1,234", "1234"],
    ["1,234,567", "1234567"],
    ["1,234.5", "1234.5"],
    ["-1,234.5", "-1234.5"],
    ["12.5", "12.5"],
    ["-500", "-500"],
    ["", ""],
    // A comma that is not a thousands separator grouped by three is not understood: never read as a decimal.
    ["12,5", "12,5"],
    ["1,234,5", "1,234,5"],
    ["1234,567", "1234,567"],
    ["1 234", "1 234"],
    ["abc", "abc"],
  ])('"," file: %j -> %j', (input, expected) => {
    expect(normalizeCsvNumber(input, ",")).toBe(expected);
  });
});

describe("csvHeaderOf", () => {
  it("returns the header a key is exported under", () => {
    expect(csvHeaderOf(CLIENT_CSV_COLUMNS, "zipCode")).toBe("Zip Code");
  });

  it("refuses an unknown key at compile time (and at run time when the table was widened)", () => {
    // @ts-expect-error "bogus" is not a key of CLIENT_CSV_COLUMNS
    expect(() => csvHeaderOf(CLIENT_CSV_COLUMNS, "bogus")).toThrow("Unknown CSV column");
  });
});

describe("csvResponse", () => {
  it("serves the rows under the headers, with the user's separator and a download name", async () => {
    const res = csvResponse(CLIENT_CSV_COLUMNS.slice(0, 2), [{ companyName: "Acme", email: "a@x.fr", ignored: 1 }], "clients.csv", "fr");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="clients.csv"');
    // Response.text() drops the BOM: read the bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1)).toBe(['"Company";"Email"', '"Acme";"a@x.fr"'].join(String.fromCharCode(13, 10)));
  });
});

describe("import limits: refused before any record is built", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => "c" + i);

  it("accepts a normal file and hands back its delimiter", () => {
    const res = parseCsvImport("Name;Budget\r\nA;1,5\r\nB;2");
    expect(res).toEqual({ ok: true, delimiter: ";", records: [{ Name: "A", Budget: "1,5" }, { Name: "B", Budget: "2" }] });
  });

  it("refuses a file with nothing, or only a header, as empty", () => {
    expect(parseCsvImport("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCsvImport("Name;Budget\r\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a header of 100 000 columns quickly, without building the rows", () => {
    // The auditor's file: ~670 KB. Building one object per row with 100 000
    // keys each exhausted the memory of the server; here the header is refused.
    const text = names(100_000).join(",") + "\r\n" + "x\r\n".repeat(50);
    const start = performance.now();
    const res = parseCsvImport(text);
    expect(res).toEqual({ ok: false, reason: "tooManyColumns", count: 100_000 });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("refuses a wide header followed by MAX_IMPORT_ROWS rows without paying rows x columns", () => {
    // 20 000 columns x 1000 rows = 20 million entries if the records were
    // built before the check (seconds, ~1 GB). Refused on the header alone.
    const text = names(20_000).join(",") + "\r\n" + "x\r\n".repeat(MAX_IMPORT_ROWS);
    const start = performance.now();
    expect(parseCsvImport(text)).toEqual({ ok: false, reason: "tooManyColumns", count: 20_000 });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("accepts a header at the column ceiling and refuses one past it", () => {
    expect(parseCsvImport(names(MAX_IMPORT_COLUMNS).join(",") + "\r\nx").ok).toBe(true);
    expect(parseCsvImport(names(MAX_IMPORT_COLUMNS + 1).join(",") + "\r\nx")).toEqual({
      ok: false,
      reason: "tooManyColumns",
      count: MAX_IMPORT_COLUMNS + 1,
    });
  });

  it("counts the data rows exactly, refusing over MAX_IMPORT_ROWS and accepting at it", () => {
    const rows = (n: number) => "Name\r\n" + "x\r\n".repeat(n);
    expect(parseCsvImport(rows(MAX_IMPORT_ROWS)).ok).toBe(true);
    expect(parseCsvImport(rows(MAX_IMPORT_ROWS + 1))).toEqual({ ok: false, reason: "tooManyRows", count: MAX_IMPORT_ROWS + 1 });
    // Blank lines are not rows.
    expect(parseCsvImport(rows(MAX_IMPORT_ROWS) + "\r\n\r\n\r\n").ok).toBe(true);
  });

  it("refuses a file over MAX_IMPORT_BYTES on its size, before reading it", async () => {
    const file = new File(["a"], "big.csv");
    Object.defineProperty(file, "size", { value: MAX_IMPORT_BYTES + 1 });
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    expect(await readCsvUpload(file)).toEqual({ ok: false, reason: "tooLarge" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("reads an upload within the limits", async () => {
    const res = await readCsvUpload(new File(["Name,Budget\r\nA,15,000"], "ok.csv"));
    expect(res.ok && res.delimiter).toBe(",");
  });
});
