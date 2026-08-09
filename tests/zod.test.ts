import { describe, it, expect } from "vitest";
import { makeObjectFromZodError } from "@/lib/zod";
import { createClientSchema } from "@/schemas/client";
import { loginSchema, requestResetSchema, resetPasswordSchema } from "@/schemas/auth";
import { createUserSchema } from "@/schemas/user";
import { createProjectSchema } from "@/schemas/project";
import { createMaterialSchema } from "@/schemas/projectMaterial";
import { createTaskSeriesSchema } from "@/schemas/task";
import { createTaskCategorySchema } from "@/schemas/taskCategory";
import { createReserveSchema } from "@/schemas/reserve";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_EMAIL_LENGTH } from "@/schemas/fields";
import { MAX_SCAN_QUANTITY } from "@/schemas/deliveryNoteScan";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

const INVALID_CLIENT = {
  email: "not-an-email",
  companyName: "",
  address: "1 St",
  city: "NYC",
  zipCode: "10001",
  country: "USA",
};

describe("makeObjectFromZodError", () => {
  it("maps each invalid field to its first (raw) error message when no dictionary is given", () => {
    const result = createClientSchema.safeParse(INVALID_CLIENT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = makeObjectFromZodError(result.error);
    expect(errors.companyName).toBe("Company name is required");
    expect(errors.email).toBe("Invalid email address");
    expect(errors.phone).toBeUndefined();
  });

  it("translates required/email errors using the given dictionary", () => {
    const result = createClientSchema.safeParse(INVALID_CLIENT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    const en = getDictionary("en");
    expect(makeObjectFromZodError(result.error, fr).companyName).toBe(fr.errors.required);
    expect(makeObjectFromZodError(result.error, fr).email).toBe(fr.errors.invalidEmail);
    expect(makeObjectFromZodError(result.error, en).companyName).toBe(en.errors.required);
    expect(makeObjectFromZodError(result.error, en).email).toBe(en.errors.invalidEmail);
  });

  it("translates a custom refine (password mismatch) using its stable i18n code", () => {
    const result = resetPasswordSchema.safeParse({
      token: "abc",
      password: "longenough1",
      confirmPassword: "different1",
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).confirmPassword).toBe(fr.errors.passwordMismatch);
  });

  it("translates a custom refine (not a number) using its stable i18n code", () => {
    const result = createProjectSchema.safeParse({
      clientId: "1",
      name: "Toiture",
      power: "not-a-number",
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).power).toBe(fr.errors.notANumber);
  });

  it("translates a too_big string issue (adversarial pass 2, point 5) with the field's max shown", () => {
    const result = createClientSchema.safeParse({
      ...INVALID_CLIENT,
      companyName: "x".repeat(MAX_NAME_LENGTH + 1),
      email: "a@x.com",
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).companyName).toBe(
      format(fr.errors.maxLength, { max: MAX_NAME_LENGTH })
    );
  });

  it("distinguishes a min-length password from a plain required field", () => {
    const result = resetPasswordSchema.safeParse({
      token: "abc",
      password: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).password).toBe("Doit contenir au moins 8 caractères.");
  });
});

describe("createProjectSchema date validation (adversarial pass 1, #1)", () => {
  // Before this, optionalDate only trimmed the string — an unparseable date
  // (or one far enough out of range that Date re-parses it as Invalid Date)
  // reached the repository's `new Date(...)` unchecked, got stored, and blew
  // up as an uncaught RangeError the next time /projects/export called
  // `.toISOString()` on it — a 500 for every user, not just the one who
  // posted the bad date.
  const BASE = { clientId: "1", name: "Toiture" };

  it("rejects an unparseable startDate instead of storing it as-is", () => {
    const result = createProjectSchema.safeParse({ ...BASE, startDate: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects a date past the range Date can represent", () => {
    const result = createProjectSchema.safeParse({ ...BASE, startDate: "+300000-01-01" });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed date", () => {
    const result = createProjectSchema.safeParse({ ...BASE, startDate: "2026-01-01" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.startDate).toBe("2026-01-01");
  });

  it("keeps treating an empty string as 'not provided', not an error", () => {
    const result = createProjectSchema.safeParse({ ...BASE, startDate: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.startDate).toBeUndefined();
  });
});

describe("optionalNumber Infinity guard (adversarial pass 2, point 2)", () => {
  // Number("1e999") is Infinity, not NaN — a bare !Number.isNaN(v) check let
  // it (and its negative counterpart) straight through into Project.power /
  // Project.budget (Float columns), where it then contaminated any
  // aggregate that read them.
  const BASE = { clientId: "1", name: "Toiture" };

  it("rejects power = 1e999 (Infinity) instead of storing it", () => {
    const result = createProjectSchema.safeParse({ ...BASE, power: "1e999" });
    expect(result.success).toBe(false);
  });

  it("rejects budget = -1e999 (-Infinity) instead of storing it", () => {
    // Adversarial pass 2, point 2 flagged an observed anomaly: budget =
    // "-1e999" (-Infinity in JS) came back out of the database as +Infinity.
    // With this guard -Infinity is rejected at the schema before it ever
    // reaches the repository, so that flip can no longer happen — not
    // chased further since the correction makes it unreachable either way.
    const result = createProjectSchema.safeParse({ ...BASE, budget: "-1e999" });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed budget/power", () => {
    const result = createProjectSchema.safeParse({ ...BASE, power: "9.5", budget: "120000" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.power).toBe(9.5);
    expect(result.data.budget).toBe(120000);
  });
});

describe("optionalPositiveNumber Infinity guard (adversarial pass 2, point 2)", () => {
  // Same trap as optionalNumber above, for ProjectMaterial.requiredQuantity:
  // Infinity is > 0, so the old `v > 0` refine alone let it through.
  const BASE = { projectId: "1", clientId: "1", name: "Panneau", quantity: "10", link: "task:5" };

  it("rejects requiredQuantity = 1e999 (Infinity) instead of storing it", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, requiredQuantity: "1e999" });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed requiredQuantity", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, requiredQuantity: "24" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.requiredQuantity).toBe(24);
  });
});

describe("free-text length ceilings (adversarial pass 2, point 5)", () => {
  // The audit proved a Reserve.description reachable at 500 000 characters
  // (2500x MAX_NOTE_LENGTH) — one character over the bound is enough to
  // prove the ceiling itself works, without repeating that extreme.
  it("rejects a Reserve.description over MAX_NOTE_LENGTH", () => {
    const result = createReserveSchema.safeParse({
      planId: "1",
      x: "0.5",
      y: "0.5",
      description: "x".repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed reserve description", () => {
    const result = createReserveSchema.safeParse({
      planId: "1",
      x: "0.5",
      y: "0.5",
      description: "Fissure sur le raccordement",
    });
    expect(result.success).toBe(true);
  });

  // The most costly case of the audit: MAX_SERIES_SIZE already capped the
  // ROW COUNT (200) but nothing capped a single row's SIZE — a 200 KB
  // `pattern` produced 200 titles of ~200 001 characters each (~40 MB
  // actually written from a ~200 KB request, measured at 961 ms for 200
  // rows). Capping `pattern` itself (same bound as a plain task's title)
  // closes the amplification without needing to validate each generated
  // title after the fact.
  it("rejects a task-series pattern beyond MAX_NAME_LENGTH instead of amplifying it across MAX_SERIES_SIZE rows", () => {
    const hugePattern = "{n}" + "x".repeat(MAX_NAME_LENGTH);
    const result = createTaskSeriesSchema.safeParse({
      projectId: "1",
      clientId: "1",
      name: "Strings",
      pattern: hugePattern,
      from: "1",
      to: "200",
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed task-series pattern", () => {
    const result = createTaskSeriesSchema.safeParse({
      projectId: "1",
      clientId: "1",
      name: "Strings",
      pattern: "String {n}",
      from: "1",
      to: "27",
    });
    expect(result.success).toBe(true);
  });

  // Passe 3a, point 5: taskCategory.name had the same missing-bound defect
  // as every other name-like field above, just not caught by the previous
  // pass's sweep.
  it("rejects a task category name over MAX_NAME_LENGTH", () => {
    const result = createTaskCategorySchema.safeParse({
      projectId: "1",
      clientId: "1",
      name: "x".repeat(MAX_NAME_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed task category name", () => {
    const result = createTaskCategorySchema.safeParse({
      projectId: "1",
      clientId: "1",
      name: "Toiture",
    });
    expect(result.success).toBe(true);
  });

  // Passe 3a, point 5: loginSchema/requestResetSchema/createUserSchema's
  // email had the same missing-bound defect as schemas/client.ts's and
  // schemas/contact.ts's own email fields (adversarial pass 2, point 5).
  it("rejects a login email over MAX_EMAIL_LENGTH", () => {
    const local = "x".repeat(MAX_EMAIL_LENGTH);
    const result = loginSchema.safeParse({ email: `${local}@example.com`, password: "whatever" });
    expect(result.success).toBe(false);
  });

  it("rejects a password-reset request email over MAX_EMAIL_LENGTH", () => {
    const local = "x".repeat(MAX_EMAIL_LENGTH);
    const result = requestResetSchema.safeParse({ email: `${local}@example.com` });
    expect(result.success).toBe(false);
  });

  it("rejects a new-user email over MAX_EMAIL_LENGTH", () => {
    const local = "x".repeat(MAX_EMAIL_LENGTH);
    const result = createUserSchema.safeParse({
      email: `${local}@example.com`,
      role: "VIEWER",
      password: "longenough1",
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed login/reset/new-user email", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "whatever" }).success).toBe(true);
    expect(requestResetSchema.safeParse({ email: "a@example.com" }).success).toBe(true);
    expect(
      createUserSchema.safeParse({ email: "a@example.com", role: "VIEWER", password: "longenough1" }).success
    ).toBe(true);
  });
});

describe("ProjectMaterial.requiredQuantity ceiling (passe 3a, point 5)", () => {
  // requiredQuantity stayed uncapped after `quantity`, on the very same row,
  // was given this exact ceiling (adversarial pass 2, point 6) — same Float
  // column class of risk.
  const BASE = { projectId: "1", clientId: "1", name: "Panneau", quantity: "10", link: "task:5" };

  it("rejects a requiredQuantity over MAX_SCAN_QUANTITY", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, requiredQuantity: String(MAX_SCAN_QUANTITY + 1) });
    expect(result.success).toBe(false);
  });

  it("accepts a requiredQuantity at exactly MAX_SCAN_QUANTITY", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, requiredQuantity: String(MAX_SCAN_QUANTITY) });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.requiredQuantity).toBe(MAX_SCAN_QUANTITY);
  });
});
