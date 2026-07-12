import { describe, it, expect } from "vitest";
import { makeObjectFromZodError } from "@/lib/zod";
import { createClientSchema } from "@/schemas/client";
import { resetPasswordSchema } from "@/schemas/auth";
import { createProjectSchema } from "@/schemas/project";
import { getDictionary } from "@/lib/i18n/dictionaries";

const INVALID_CLIENT = {
  firstName: "",
  lastName: "Smith",
  email: "not-an-email",
  companyName: "Acme",
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
    expect(errors.firstName).toBe("First name is required");
    expect(errors.email).toBe("Invalid email address");
    expect(errors.lastName).toBeUndefined();
  });

  it("translates required/email errors using the given dictionary", () => {
    const result = createClientSchema.safeParse(INVALID_CLIENT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const fr = getDictionary("fr");
    const en = getDictionary("en");
    expect(makeObjectFromZodError(result.error, fr).firstName).toBe(fr.errors.required);
    expect(makeObjectFromZodError(result.error, fr).email).toBe(fr.errors.invalidEmail);
    expect(makeObjectFromZodError(result.error, en).firstName).toBe(en.errors.required);
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
