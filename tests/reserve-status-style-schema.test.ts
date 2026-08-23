import { describe, it, expect } from "vitest";
import { updateReserveStatusStyleSchema } from "@/schemas/reserve";

const valid = {
  projectId: "2",
  openLabel: "À traiter",
  openColor: "#ff8800",
  resolvedLabel: "Terminée",
  resolvedColor: "#059669",
};

describe("updateReserveStatusStyleSchema", () => {
  it("accepts a fully configured payload", () => {
    const result = updateReserveStatusStyleSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        projectId: 2,
        openLabel: "À traiter",
        openColor: "#ff8800",
        resolvedLabel: "Terminée",
        resolvedColor: "#059669",
      });
    }
  });

  it("resolves every field missing entirely to null (the degenerate, most common case: nothing configured)", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ projectId: "2" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openLabel ?? null).toBeNull();
      expect(result.data.openColor ?? null).toBeNull();
      expect(result.data.resolvedLabel ?? null).toBeNull();
      expect(result.data.resolvedColor ?? null).toBeNull();
    }
  });

  it("turns an empty label back into null — clearing a custom label resolves to the default, not the empty string", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openLabel: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openLabel).toBeNull();
  });

  it("turns a whitespace-only label into null too — otherwise the database CHECK (btrim(...) > 0) would 500", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openLabel: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openLabel).toBeNull();
  });

  it("trims a label before storing it", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openLabel: "  À traiter  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openLabel).toBe("À traiter");
  });

  it("turns an empty colour back into null", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openColor: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openColor).toBeNull();
  });

  it("rejects a label over MAX_NAME_LENGTH (200)", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openLabel: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects a label carrying a control character (a newline smuggled into a one-line pill)", () => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openLabel: "Line one\nLine two" });
    expect(result.success).toBe(false);
  });

  it.each(["red", "#fff", "#ff8800ff", "ff8800", "javascript:alert(1)"])(
    "rejects %s as a colour (must reuse schemas/appSettings.ts's strict 6-digit hexColor)",
    (value) => {
      const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openColor: value });
      expect(result.success).toBe(false);
    }
  );

  it("rejects a missing/invalid projectId", () => {
    expect(updateReserveStatusStyleSchema.safeParse({ ...valid, projectId: "not-a-number" }).success).toBe(false);
    expect(updateReserveStatusStyleSchema.safeParse({ ...valid, projectId: "-1" }).success).toBe(false);
    const { projectId: _projectId, ...withoutProjectId } = valid;
    void _projectId;
    expect(updateReserveStatusStyleSchema.safeParse(withoutProjectId).success).toBe(false);
  });

  it("lets the open and resolved statuses be configured independently — one set, the other left absent", () => {
    const result = updateReserveStatusStyleSchema.safeParse({
      projectId: "2",
      openLabel: "À traiter",
      openColor: "#ff8800",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resolvedLabel ?? null).toBeNull();
      expect(result.data.resolvedColor ?? null).toBeNull();
    }
  });
});
