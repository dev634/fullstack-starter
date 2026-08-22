import { describe, it, expect } from "vitest";
import { makeObjectFromZodError } from "@/lib/zod";
import { createClientSchema } from "@/schemas/client";
import { loginSchema, requestResetSchema, resetPasswordSchema } from "@/schemas/auth";
import { createUserSchema } from "@/schemas/user";
import { createProjectSchema } from "@/schemas/project";
import { createMaterialSchema } from "@/schemas/projectMaterial";
import { createTaskSchema, createTaskSeriesSchema } from "@/schemas/task";
import { createTaskCategorySchema } from "@/schemas/taskCategory";
import { createReserveSchema } from "@/schemas/reserve";
import { MAX_SCAN_STRING_LENGTH } from "@/schemas/deliveryNoteScan";
import { createContactSchema } from "@/schemas/contact";
import { MAX_NAME_LENGTH, MAX_CODE_LENGTH, MAX_NOTE_LENGTH, MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH, MAX_REFERENCE_LENGTH } from "@/schemas/fields";
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

describe("MAX_PHONE_LENGTH (fix/blocked-legitimate-input, point 1)", () => {
  // 30 was demonstrably a defect: this constant's own former comment said it
  // fit "an international number with formatting (spaces, +, extension)",
  // but neither of these two ordinary shapes (31 characters each) actually
  // did — a company/contact record already carrying two phone numbers could
  // no longer even be re-saved. This is the exact example from
  // schemas/fields.ts's comment: the test that would have caught the defect.
  it("accepts a phone number with an international prefix and an extension — the schema's own documented example", () => {
    const result = createContactSchema.safeParse({
      clientId: "1",
      firstName: "Jean",
      lastName: "Dupont",
      phone: "+33 (0)1 23 45 67 89 poste 1234",
    });
    expect(result.success).toBe(true);
  });

  it("accepts two numbers separated by a slash (office + mobile) — the other documented example", () => {
    const result = createContactSchema.safeParse({
      clientId: "1",
      firstName: "Jean",
      lastName: "Dupont",
      phone: "01 23 45 67 89 / 06 12 34 56 78",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a phone number past MAX_PHONE_LENGTH", () => {
    const result = createContactSchema.safeParse({
      clientId: "1",
      firstName: "Jean",
      lastName: "Dupont",
      phone: "0".repeat(MAX_PHONE_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("Numeric too_small/too_big messages (fix/blocked-legitimate-input, point 3)", () => {
  // Before this, translateZodIssue (lib/i18n/zodErrors.ts) only special-cased
  // too_small/too_big for origin "string" — a number fell all the way
  // through to the generic fallbacks, which lie: -5 (too_small, min 0) said
  // "Ce champ est requis." on a field that plainly wasn't empty, and
  // 2 000 000 (too_big, max MAX_SCAN_QUANTITY) said "Champ invalide." with no
  // indication of what the actual ceiling was.
  const BASE = { projectId: "1", clientId: "1", name: "Panneau", link: "" };

  it("says the actual minimum, not 'this field is required', for a negative quantity", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, quantity: "-5" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).quantity).toBe(format(fr.errors.minValue, { min: 0 }));
    expect(makeObjectFromZodError(result.error, fr).quantity).not.toBe(fr.errors.required);
  });

  it("says the actual maximum, not 'invalid field', for a quantity over MAX_SCAN_QUANTITY", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, quantity: String(MAX_SCAN_QUANTITY + 1) });
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    expect(makeObjectFromZodError(result.error, fr).quantity).toBe(
      format(fr.errors.maxValue, { max: MAX_SCAN_QUANTITY })
    );
    expect(makeObjectFromZodError(result.error, fr).quantity).not.toBe(fr.errors.invalid);
  });

  it("still accepts a well-formed quantity", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, quantity: "10" });
    expect(result.success).toBe(true);
  });
});

describe("Reserve GPS coordinates accept a French decimal comma (fix/blocked-legitimate-input, point 3)", () => {
  // A GPS field typed by hand on a French keyboard (inputMode="decimal")
  // produces a comma, not a dot — "48,8566" used to coerce to NaN, which zod
  // reports as invalid_type, translated as "Ce champ est requis." even
  // though the field plainly wasn't empty.
  const BASE = { planId: "1", x: "0.5", y: "0.5", description: "Fissure sur le raccordement" };

  it("accepts '48,8566' as latitude, same value as '48.8566'", () => {
    const result = createReserveSchema.safeParse({ ...BASE, latitude: "48,8566", longitude: "2,3522" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.latitude).toBeCloseTo(48.8566);
    expect(result.data.longitude).toBeCloseTo(2.3522);
  });

  it("still accepts a dot-separated coordinate", () => {
    const result = createReserveSchema.safeParse({ ...BASE, latitude: "48.8566" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.latitude).toBeCloseTo(48.8566);
  });

  it("still rejects a coordinate that isn't a number even after comma normalization", () => {
    const result = createReserveSchema.safeParse({ ...BASE, latitude: "abc" });
    expect(result.success).toBe(false);
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

describe("ProjectMaterial free-text ceilings (passe 3b (C2), point 2)", () => {
  // name/unit/supplierName/reference had no upper bound at all — the other
  // nine schemas got their tiers two days ago (adversarial pass 2, point 5),
  // this one was missed. One character over each field's own tier is enough
  // to prove the ceiling works, without repeating the 100 000-character
  // extreme the audit already proved reachable on other fields.
  const BASE = { projectId: "1", clientId: "1", name: "Panneau", quantity: "10", link: "" };

  it("rejects a name over MAX_NAME_LENGTH", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, name: "x".repeat(MAX_NAME_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  it("rejects a unit over MAX_CODE_LENGTH", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, unit: "x".repeat(MAX_CODE_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  it("rejects a supplierName over MAX_NAME_LENGTH", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, supplierName: "x".repeat(MAX_NAME_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  // Ce test affirmait un plafond de MAX_CODE_LENGTH (40) sur `reference`. Il
  // etait vert et il avait tort : le scan de bulletin ecrit `reference`
  // directement en base jusqu`a MAX_SCAN_STRING_LENGTH (200), donc un materiau
  // cree par scan avec une reference plus longue que 40 serait devenu
  // impossible a re-enregistrer a la main — sur un champ que l`utilisateur
  // n`aurait meme pas touche. Assertion retournee plutot que supprimee.
  it("accepts a reference as long as the delivery-note scan can write", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, reference: "x".repeat(MAX_SCAN_STRING_LENGTH) });
    expect(result.success).toBe(true);
  });

  it("rejects a reference over MAX_REFERENCE_LENGTH", () => {
    const result = createMaterialSchema.safeParse({ ...BASE, reference: "x".repeat(MAX_REFERENCE_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  it("keeps the manual ceiling and the scan ceiling equal, so neither path can strand the other", () => {
    expect(MAX_REFERENCE_LENGTH).toBe(MAX_SCAN_STRING_LENGTH);
  });

  it("still accepts well-formed name/unit/supplierName/reference values", () => {
    const result = createMaterialSchema.safeParse({
      ...BASE,
      unit: "pièce",
      supplierName: "Solaredge",
      reference: "SE-5000",
    });
    expect(result.success).toBe(true);
  });
});

describe("createTaskSchema dueDate validation (passe 3b (C2), point 3)", () => {
  // The one date schema the adversarial pass's recensement missed: unlike
  // schemas/project.ts's optionalDate and schemas/intervention.ts's
  // scheduledAtSchema, this file's own optionalDate only trimmed the string —
  // an unparseable or out-of-range dueDate reached the repository's
  // `new Date(...)` unchecked, the exact defect that made /projects/export
  // 500 for everyone, permanently, the last time a date field went in
  // unvalidated (see createProjectSchema's own test above).
  const BASE = { projectId: "1", clientId: "1", title: "Poser les panneaux" };

  it("rejects an unparseable dueDate instead of storing it as-is", () => {
    const result = createTaskSchema.safeParse({ ...BASE, dueDate: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects a dueDate past the range Date can represent", () => {
    const result = createTaskSchema.safeParse({ ...BASE, dueDate: "+300000-01-01" });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed dueDate", () => {
    const result = createTaskSchema.safeParse({ ...BASE, dueDate: "2026-01-01" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dueDate).toBe("2026-01-01");
  });

  it("keeps treating an empty string as 'not provided', not an error", () => {
    const result = createTaskSchema.safeParse({ ...BASE, dueDate: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dueDate).toBeUndefined();
  });
});
