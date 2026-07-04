import { describe, it, expect } from "vitest";
import { makeObjectFromZodError } from "@/lib/zod";
import { createClientSchema } from "@/schemas/client";

describe("makeObjectFromZodError", () => {
  it("maps each invalid field to its first error message", () => {
    const result = createClientSchema.safeParse({
      firstName: "",
      lastName: "Smith",
      email: "not-an-email",
      companyName: "Acme",
      address: "1 St",
      city: "NYC",
      zipCode: "10001",
      country: "USA",
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = makeObjectFromZodError(result.error);
    expect(errors.firstName).toBe("First name is required");
    expect(errors.email).toBe("Invalid email address");
    expect(errors.lastName).toBeUndefined();
  });
});
