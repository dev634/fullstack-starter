import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "@/lib/csv";

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
