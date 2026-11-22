import { describe, it, expect } from "vitest";
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

describe("normalizeCsvDate", () => {
  it("converts JJ/MM/AAAA day-first and leaves everything else alone", () => {
    expect(normalizeCsvDate("15/06/2026")).toBe("2026-06-15");
    expect(normalizeCsvDate("03/04/2026")).toBe("2026-04-03");
    expect(normalizeCsvDate("3/4/2026")).toBe("2026-04-03");
    expect(normalizeCsvDate("2026-06-15")).toBe("2026-06-15");
    expect(normalizeCsvDate("")).toBe("");
    expect(normalizeCsvDate("June 15")).toBe("June 15");
    expect(normalizeCsvDate("15/06/26")).toBe("15/06/26");
  });
});

describe("normalizeCsvNumber", () => {
  it.each([
    ["12,5", "12.5"],
    ["12.5", "12.5"],
    ["-500", "-500"],
    ["-1 234,5", "-1234.5"],
    ["1 234,5", "1234.5"],
    ["1 234 567,5", "1234567.5"],
    ["1.234,5", "1234.5"],
    ["1,234.5", "1234.5"],
    ["1,234,567", "1234567"],
    ["", ""],
    ["abc", "abc"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeCsvNumber(input)).toBe(expected);
  });
});
