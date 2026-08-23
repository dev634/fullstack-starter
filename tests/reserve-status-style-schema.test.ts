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

  it("leaves every field missing entirely as undefined when the form sends nothing at all (the degenerate, most common case: nothing configured)", () => {
    // NOT `result.data.openLabel ?? null` — that coalesces BOTH `null` and
    // `undefined` to the same assertion, so it can't tell "the schema
    // resolved this to null" apart from "this key was never even parsed".
    // The real answer: ZodOptional short-circuits to `undefined` without
    // running the inner preprocess/refine chain at all when the key is
    // absent — the schema itself never produces `null` here. It's
    // actions/reserves/reserves.ts's `updateReserveStatusStyle` that turns
    // `undefined` into the database's NULL via its own `?? null` right
    // before writing (see its own test in tests/reserve-actions.test.ts) —
    // this test only covers what THIS schema does on its own.
    const result = updateReserveStatusStyleSchema.safeParse({ projectId: "2" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openLabel).toBeUndefined();
      expect(result.data.openColor).toBeUndefined();
      expect(result.data.resolvedLabel).toBeUndefined();
      expect(result.data.resolvedColor).toBeUndefined();
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
    // Same reasoning as the "missing entirely" test above: an absent field
    // stays undefined at the schema level, never null.
    if (result.success) {
      expect(result.data.resolvedLabel).toBeUndefined();
      expect(result.data.resolvedColor).toBeUndefined();
    }
  });

  it.each([
    // A colour is interpolated raw into a <style> tag (ReserveStatusStyleVars)
    // and into a PDF fillColor call — both anchors of hexColor's regex
    // (^...$) must actually block anything past the 6 hex digits, not just
    // reject it in the common case.
    ["a CSS declaration smuggled after a valid-looking prefix", "#000000; background:url(https://evil/)"],
    ["a valid hex followed by a trailing newline", "#000000\n"],
  ])("rejects %s as a colour", (_label, value) => {
    const result = updateReserveStatusStyleSchema.safeParse({ ...valid, openColor: value });
    expect(result.success).toBe(false);
  });
});
