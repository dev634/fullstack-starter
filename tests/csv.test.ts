import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, csvCell } from "@/lib/csv";

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
