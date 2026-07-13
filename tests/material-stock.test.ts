import { describe, it, expect } from "vitest";
import { materialStockStatus } from "@/lib/materialStock";

describe("materialStockStatus", () => {
  it("is red when there is nothing in stock", () => {
    expect(materialStockStatus(0, 24)).toBe("red");
  });

  it("is green when stock fully covers what's required", () => {
    expect(materialStockStatus(24, 24)).toBe("green");
    expect(materialStockStatus(30, 24)).toBe("green");
  });

  it("is orange when some stock exists but not enough", () => {
    expect(materialStockStatus(10, 24)).toBe("orange");
  });

  it("treats negative stock the same as zero (red)", () => {
    expect(materialStockStatus(-1, 24)).toBe("red");
  });
});
