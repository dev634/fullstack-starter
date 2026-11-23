import { describe, it, expect } from "vitest";
import { MAX_PHONE_LENGTH } from "@/schemas/fields";
import { createContactSchema } from "@/schemas/contact";
import { createClientSchema } from "@/schemas/client";
import { csvCell, unescapeCsvCell } from "@/lib/csv";

// F12 — every example documented beside MAX_PHONE_LENGTH, with its COUNTED
// length. A ceiling contradicted by its own commentary is how 60 reached
// production: the 63/65/72-character shapes below were refused.
const DOCUMENTED: [string, number][] = [
  ["+33 (0)1 23 45 67 89 poste 1234", 31],
  ["01 23 45 67 89 / 06 12 34 56 78", 31],
  ["+33 1 23 45 67 89 (bureau) / +33 6 12 34 56 78 (mobile)", 55],
  ["+33 (0)1 23 45 67 89 poste 1234 / +33 (0)6 12 34 56 78 (mobile)", 63],
  ["+33 (0)1 23 45 67 89 poste 1234 / +33 (0)6 12 34 56 78 poste 5678", 65],
  ["+33 (0)1 23 45 67 89 poste 1234 (bureau) / +33 (0)6 12 34 56 78 (mobile)", 72],
];

const contact = (phone: string) => createContactSchema.safeParse({ clientId: "1", firstName: "Jean", lastName: "Dupont", phone });
const client = (phone: string) =>
  createClientSchema.safeParse({
    email: "a@x.fr",
    companyName: "Acme",
    address: "1 rue",
    city: "Lyon",
    zipCode: "69000",
    country: "France",
    phone,
  });

describe("MAX_PHONE_LENGTH (F12)", () => {
  it("is 80", () => {
    expect(MAX_PHONE_LENGTH).toBe(80);
  });

  it.each(DOCUMENTED)("the documented example %j has the counted length %i", (phone, length) => {
    expect(phone).toHaveLength(length);
  });

  it.each(DOCUMENTED)("accepts the documented example %j (contact and company)", (phone) => {
    expect(contact(phone).success).toBe(true);
    expect(client(phone).success).toBe(true);
  });

  it("accepts exactly MAX_PHONE_LENGTH characters and refuses one more", () => {
    expect(contact("1".repeat(MAX_PHONE_LENGTH)).success).toBe(true);
    expect(contact("1".repeat(MAX_PHONE_LENGTH + 1)).success).toBe(false);
    expect(client("1".repeat(MAX_PHONE_LENGTH + 1)).success).toBe(false);
  });

  // The export guards a leading "+" with an apostrophe (ceiling + 1 in the
  // file); the import removes it, so the value that reaches the schema is the
  // original one and a phone AT the ceiling still round-trips.
  it("a '+' phone at the ceiling survives csvCell then unescapeCsvCell and still passes", () => {
    const phone = "+".padEnd(MAX_PHONE_LENGTH, "1");
    const cell = csvCell(phone).slice(1, -1); // the body inside the quotes
    expect(cell).toHaveLength(MAX_PHONE_LENGTH + 1);
    const back = unescapeCsvCell(cell);
    expect(back).toBe(phone);
    expect(contact(back).success).toBe(true);
    // Without the inverse it would have been refused:
    expect(contact(cell).success).toBe(false);
  });
});
