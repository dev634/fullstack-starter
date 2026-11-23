import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import z from "zod";
import { updateProjectSchema } from "@/schemas/project";
import { updateClientSchema } from "@/schemas/client";
import { updateContactSchema } from "@/schemas/contact";
import { updateEquipmentSchema } from "@/schemas/equipment";
import { editLoanSchema } from "@/schemas/equipmentLoan";
import { updateInterventionSchema } from "@/schemas/intervention";
import { updateReserveSchema, updateReserveStatusStyleSchema } from "@/schemas/reserve";
import { updateMaterialSchema } from "@/schemas/projectMaterial";
import { updateTaskSchema } from "@/schemas/task";
import { clearable } from "@/schemas/fields";

/**
 * "Absent is not empty" at the schema (lot 5b). For every UPDATE schema, per
 * field: a key that is ABSENT parses to `undefined` (the column is left
 * alone), a key that is BLANK or null parses to `null` (cleared — for a
 * clearable field), a value parses to the value. And no update schema carries
 * a `.default()`: the degenerate payload (only the ids) must come out with
 * every other key undefined — a default would show up here as a defined value.
 */

function parse<T extends z.ZodType>(schema: T, input: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

/** Every key of `data` except the ones listed must be undefined. */
function definedKeys(data: object, except: string[]): string[] {
  return Object.entries(data)
    .filter(([key, value]) => !except.includes(key) && value !== undefined)
    .map(([key]) => key);
}

describe("the `clearable` primitive", () => {
  const schema = z.object({ f: clearable(z.string().max(5)) });

  it("absent -> undefined, blank/whitespace/null -> null, value -> value", () => {
    expect(schema.parse({}).f).toBeUndefined();
    expect(schema.parse({ f: undefined }).f).toBeUndefined();
    expect(schema.parse({ f: "" }).f).toBeNull();
    expect(schema.parse({ f: "   " }).f).toBeNull();
    expect(schema.parse({ f: null }).f).toBeNull();
    expect(schema.parse({ f: "abc" }).f).toBe("abc");
  });

  it("still validates a non-blank value", () => {
    expect(schema.safeParse({ f: "abcdef" }).success).toBe(false);
    expect(schema.safeParse({ f: 5 }).success).toBe(false);
  });
});

describe("updateProjectSchema", () => {
  const ids = { id: "3", clientId: "1" };

  it("the degenerate payload (ids only) carries no default: type/status stay undefined", () => {
    const data = parse(updateProjectSchema, ids);
    expect(definedKeys(data, ["id", "clientId"])).toEqual([]);
    expect(data.type).toBeUndefined();
    expect(data.status).toBeUndefined();
  });

  it("blank -> null for every clearable field, null explicit too", () => {
    const blank = { ...ids, businessNumber: "", power: "", budget: " ", address: "", startDate: "", endDate: "", notes: "" };
    expect(parse(updateProjectSchema, blank)).toMatchObject({
      businessNumber: null, power: null, budget: null, address: null, startDate: null, endDate: null, notes: null,
    });
    const nulls = { ...ids, businessNumber: null, power: null, budget: null, address: null, startDate: null, endDate: null, notes: null };
    expect(parse(updateProjectSchema, nulls)).toMatchObject({ power: null, startDate: null, notes: null });
  });

  it("values pass through, numbers coerced, 0 kept (a zero budget is a value, not blank)", () => {
    const data = parse(updateProjectSchema, {
      ...ids, name: "Toiture", type: "OMBRIERE", status: "EN_COURS", power: "9.5", budget: "0",
      startDate: "2026-06-01", endDate: "2026-06-30", notes: "n",
    });
    expect(data).toMatchObject({ name: "Toiture", type: "OMBRIERE", status: "EN_COURS", power: 9.5, budget: 0, startDate: "2026-06-01", endDate: "2026-06-30" });
  });

  it("refuses a blank required name (not a clear), a non-finite number, a bad date, an inverted range", () => {
    expect(updateProjectSchema.safeParse({ ...ids, name: "" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ ...ids, power: "1e999" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ ...ids, startDate: "2026-02-30" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ ...ids, startDate: "2026-06-30", endDate: "2026-06-01" }).success).toBe(false);
  });

  it("a cleared bound never fails the range rule", () => {
    expect(updateProjectSchema.safeParse({ ...ids, startDate: "", endDate: "2026-06-01" }).success).toBe(true);
  });
});

describe("updateClientSchema", () => {
  it("the degenerate payload carries no default: status stays undefined", () => {
    const data = parse(updateClientSchema, { id: "1" });
    expect(definedKeys(data, ["id"])).toEqual([]);
  });

  it("blank phone/website -> null; a blank required field is refused, not cleared", () => {
    expect(parse(updateClientSchema, { id: "1", phone: "", website: "" })).toMatchObject({ phone: null, website: null });
    expect(updateClientSchema.safeParse({ id: "1", companyName: "" }).success).toBe(false);
    expect(updateClientSchema.safeParse({ id: "1", email: "not-an-email" }).success).toBe(false);
  });

  it("values pass through", () => {
    expect(parse(updateClientSchema, { id: "1", phone: "01 23", status: "CLIENT" })).toMatchObject({ phone: "01 23", status: "CLIENT" });
  });
});

describe("updateContactSchema", () => {
  const ids = { id: "1", clientId: "2" };

  it("the degenerate payload leaves every column undefined", () => {
    expect(definedKeys(parse(updateContactSchema, ids), ["id", "clientId"])).toEqual([]);
  });

  it("blank email/phone/function -> null; values pass through", () => {
    expect(parse(updateContactSchema, { ...ids, email: "", phone: "", jobFunctionId: "" })).toMatchObject({ email: null, phone: null, jobFunctionId: null });
    expect(parse(updateContactSchema, { ...ids, email: "a@b.fr", phone: "06", jobFunctionId: "4", firstName: "A" })).toMatchObject({
      email: "a@b.fr", phone: "06", jobFunctionId: 4, firstName: "A",
    });
  });

  it("refuses a blank first/last name", () => {
    expect(updateContactSchema.safeParse({ ...ids, firstName: "" }).success).toBe(false);
    expect(updateContactSchema.safeParse({ ...ids, lastName: "" }).success).toBe(false);
  });
});

describe("updateEquipmentSchema", () => {
  it("the degenerate payload leaves name and reference undefined", () => {
    expect(definedKeys(parse(updateEquipmentSchema, { id: "1" }), ["id"])).toEqual([]);
  });

  it("blank / whitespace reference -> null (the one 'none' the CHECK allows); a value is trimmed", () => {
    expect(parse(updateEquipmentSchema, { id: "1", reference: "" }).reference).toBeNull();
    expect(parse(updateEquipmentSchema, { id: "1", reference: "   " }).reference).toBeNull();
    expect(parse(updateEquipmentSchema, { id: "1", reference: "  REF-1 " }).reference).toBe("REF-1");
  });

  it("still refuses a control character in a reference and a blank name", () => {
    expect(updateEquipmentSchema.safeParse({ id: "1", reference: "a\tb" }).success).toBe(false);
    expect(updateEquipmentSchema.safeParse({ id: "1", name: "  " }).success).toBe(false);
  });
});

describe("editLoanSchema", () => {
  it("the degenerate payload leaves dueAt and note undefined", () => {
    expect(definedKeys(parse(editLoanSchema, { id: "1" }), ["id"])).toEqual([]);
  });

  it("blank dueAt/note -> null; values pass through, the note trimmed", () => {
    expect(parse(editLoanSchema, { id: "1", dueAt: "", note: "  " })).toMatchObject({ dueAt: null, note: null });
    expect(parse(editLoanSchema, { id: "1", dueAt: "2026-02-01", note: " Rendre vendredi " })).toMatchObject({
      dueAt: "2026-02-01", note: "Rendre vendredi",
    });
  });

  it("refuses an impossible date", () => {
    expect(editLoanSchema.safeParse({ id: "1", dueAt: "2026-02-30" }).success).toBe(false);
  });
});

describe("updateInterventionSchema", () => {
  const ids = { id: "1", projectId: "2", clientId: "3" };

  it("the degenerate payload carries no default: status stays undefined", () => {
    const data = parse(updateInterventionSchema, ids);
    expect(definedKeys(data, ["id", "projectId", "clientId"])).toEqual([]);
    expect(data.status).toBeUndefined();
  });

  it("blank technician -> null; values pass through", () => {
    expect(parse(updateInterventionSchema, { ...ids, technician: "" }).technician).toBeNull();
    expect(
      parse(updateInterventionSchema, { ...ids, technician: "Paul", status: "FAITE", description: "d", scheduledAt: "2026-08-01T07:30:00.000Z" })
    ).toMatchObject({ technician: "Paul", status: "FAITE", description: "d", scheduledAt: "2026-08-01T07:30:00.000Z" });
  });

  it("refuses a blank description and a zone-less instant", () => {
    expect(updateInterventionSchema.safeParse({ ...ids, description: "" }).success).toBe(false);
    expect(updateInterventionSchema.safeParse({ ...ids, scheduledAt: "2026-08-01T07:30" }).success).toBe(false);
  });
});

describe("updateReserveSchema", () => {
  it("the degenerate payload carries no default: status stays undefined (it used to reopen a resolved réserve)", () => {
    const data = parse(updateReserveSchema, { id: "1" });
    expect(definedKeys(data, ["id"])).toEqual([]);
    expect(data.status).toBeUndefined();
  });

  it("blank / null coordinates -> null; 0 is a value; a comma decimal is read", () => {
    expect(parse(updateReserveSchema, { id: "1", latitude: "", longitude: "" })).toMatchObject({ latitude: null, longitude: null });
    expect(parse(updateReserveSchema, { id: "1", latitude: null, longitude: null })).toMatchObject({ latitude: null, longitude: null });
    expect(parse(updateReserveSchema, { id: "1", latitude: "0", longitude: "48,8566" })).toMatchObject({ latitude: 0, longitude: 48.8566 });
  });

  it("still range-checks a coordinate", () => {
    expect(updateReserveSchema.safeParse({ id: "1", latitude: "91" }).success).toBe(false);
    expect(updateReserveSchema.safeParse({ id: "1", longitude: "-181" }).success).toBe(false);
  });
});

describe("updateReserveStatusStyleSchema", () => {
  it("absent -> undefined, blank -> null, value -> value (the schema already distinguished them)", () => {
    const absent = parse(updateReserveStatusStyleSchema, { projectId: "2" });
    expect(definedKeys(absent, ["projectId"])).toEqual([]);
    expect(parse(updateReserveStatusStyleSchema, { projectId: "2", openLabel: "", openColor: "" })).toMatchObject({ openLabel: null, openColor: null });
    expect(parse(updateReserveStatusStyleSchema, { projectId: "2", openLabel: "À traiter", openColor: "#ff8800" })).toMatchObject({
      openLabel: "À traiter", openColor: "#ff8800",
    });
  });
});

describe("updateMaterialSchema", () => {
  const ids = { id: "1", projectId: "2", clientId: "3" };

  it("the degenerate payload leaves every column undefined — link and requiredQuantity included", () => {
    const data = parse(updateMaterialSchema, ids);
    expect(definedKeys(data, ["id", "projectId", "clientId"])).toEqual([]);
  });

  it("blank unit/supplier/reference/requiredQuantity/category -> null", () => {
    expect(parse(updateMaterialSchema, { ...ids, unit: "", supplierName: "", reference: "", requiredQuantity: "", materialCategoryId: "" })).toMatchObject({
      unit: null, supplierName: null, reference: null, requiredQuantity: null, materialCategoryId: null,
    });
  });

  it("values pass through, a quantity of 0 is kept", () => {
    expect(parse(updateMaterialSchema, { ...ids, name: "Câble", quantity: "0", unit: "m", reference: "R-1", materialCategoryId: "4" })).toMatchObject({
      name: "Câble", quantity: 0, unit: "m", reference: "R-1", materialCategoryId: 4,
    });
  });

  describe("link", () => {
    it("absent leaves the three link columns alone (the keys are not even present)", () => {
      const data = parse(updateMaterialSchema, ids);
      expect("taskId" in data || "taskGroupId" in data || "taskCategoryId" in data).toBe(false);
    });

    it("'' clears all three, and clears requiredQuantity when the payload did not carry one (the form omits it while unlinked)", () => {
      expect(parse(updateMaterialSchema, { ...ids, link: "" })).toMatchObject({
        taskId: null, taskGroupId: null, taskCategoryId: null, requiredQuantity: null,
      });
    });

    it("'' with an explicit requiredQuantity keeps what was sent", () => {
      expect(parse(updateMaterialSchema, { ...ids, link: "", requiredQuantity: "8" })).toMatchObject({ taskId: null, requiredQuantity: 8 });
    });

    it("'kind:id' sets that one and clears the other two", () => {
      expect(parse(updateMaterialSchema, { ...ids, link: "task:5", requiredQuantity: "20" })).toMatchObject({ taskId: 5, taskGroupId: null, taskCategoryId: null });
      expect(parse(updateMaterialSchema, { ...ids, link: "group:6", requiredQuantity: "20" })).toMatchObject({ taskId: null, taskGroupId: 6, taskCategoryId: null });
      expect(parse(updateMaterialSchema, { ...ids, link: "category:7", requiredQuantity: "20" })).toMatchObject({ taskId: null, taskGroupId: null, taskCategoryId: 7 });
    });

    it("REFUSES a malformed value instead of detaching the material", () => {
      for (const bad of ["task", "task:", "task:0", "task:-1", "task:abc", "bogus:3", "task:1.5", "task:03", "task:1:2", " task:5", "none"]) {
        const result = updateMaterialSchema.safeParse({ ...ids, link: bad, requiredQuantity: "20" });
        expect(result.success, bad).toBe(false);
      }
    });

    it("a target without a usable requiredQuantity is refused (absent or blank)", () => {
      expect(updateMaterialSchema.safeParse({ ...ids, link: "task:5" }).success).toBe(false);
      expect(updateMaterialSchema.safeParse({ ...ids, link: "task:5", requiredQuantity: "" }).success).toBe(false);
      expect(updateMaterialSchema.safeParse({ ...ids, link: "task:5", requiredQuantity: "0" }).success).toBe(false);
    });
  });
});

describe("updateTaskSchema", () => {
  const ids = { id: "1", projectId: "2", clientId: "3" };

  it("the degenerate payload leaves title, dueDate and quantityTarget undefined", () => {
    expect(definedKeys(parse(updateTaskSchema, ids), ["id", "projectId", "clientId"])).toEqual([]);
  });

  it("blank dueDate/quantityTarget -> null (blank target reverts to a plain checkbox); values pass through", () => {
    expect(parse(updateTaskSchema, { ...ids, dueDate: "", quantityTarget: "" })).toMatchObject({ dueDate: null, quantityTarget: null });
    expect(parse(updateTaskSchema, { ...ids, title: "T", dueDate: "2026-06-01", quantityTarget: "20" })).toMatchObject({
      title: "T", dueDate: "2026-06-01", quantityTarget: 20,
    });
  });

  it("refuses a blank title, a zero or fractional target", () => {
    expect(updateTaskSchema.safeParse({ ...ids, title: "" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ ...ids, quantityTarget: "0" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ ...ids, quantityTarget: "1.5" }).success).toBe(false);
  });
});

// Every `update*Schema` / `edit*Schema` EXPORTED by schemas/ — discovered from
// the directory, not listed by hand: four of them (updateUserSchema,
// updateMaterialCategorySchema, updateAppSettingsSchema, updateTaskQuantitySchema)
// escaped the hand-written list this replaces. Each discovered schema needs a
// row below: the minimal VALID payload and the keys that payload legitimately
// makes defined (its ids and its required fields). A schema with no row, or a
// row with no schema, fails — the table cannot drift from the directory.
const IDS3 = { id: "1", projectId: "1", clientId: "1" };
const MINIMAL: Record<string, { input: Record<string, unknown>; defined: string[] }> = {
  updateProjectSchema: { input: { id: "1", clientId: "1" }, defined: ["id", "clientId"] },
  updateClientSchema: { input: { id: "1" }, defined: ["id"] },
  updateContactSchema: { input: { id: "1", clientId: "1" }, defined: ["id", "clientId"] },
  updateEquipmentSchema: { input: { id: "1" }, defined: ["id"] },
  editLoanSchema: { input: { id: "1" }, defined: ["id"] },
  updateInterventionSchema: { input: IDS3, defined: ["id", "projectId", "clientId"] },
  updateReserveSchema: { input: { id: "1" }, defined: ["id"] },
  updateReserveStatusStyleSchema: { input: { projectId: "1" }, defined: ["projectId"] },
  updateMaterialSchema: { input: IDS3, defined: ["id", "projectId", "clientId"] },
  updateTaskSchema: { input: IDS3, defined: ["id", "projectId", "clientId"] },
  // Required fields (not optional by design): they are the ONLY keys allowed defined.
  updateUserSchema: { input: { id: "1", role: "EDITOR" }, defined: ["id", "role"] },
  updateMaterialCategorySchema: { input: { ...IDS3, name: "Câbles" }, defined: ["id", "projectId", "clientId", "name"] },
  updateAppSettingsSchema: {
    input: { appName: "App", primaryColor: "#000000", accentColor: "#ffffff" },
    defined: ["appName", "primaryColor", "accentColor"],
  },
  updateTaskQuantitySchema: { input: { ...IDS3, quantityDone: "3" }, defined: ["id", "projectId", "clientId", "quantityDone"] },
};
// Recounted at lot 5b (on 09fbd0b + the lot 5b changes): exports of schemas/*.ts
// whose name matches ^(update|edit).*Schema$, by this very discovery.
const EXPECTED_UPDATE_SCHEMAS = 14;
const UPDATE_SCHEMA_NAME = /^(update|edit)[A-Za-z]*Schema$/;

async function discoverUpdateSchemas(): Promise<Map<string, z.ZodType>> {
  const found = new Map<string, z.ZodType>();
  for (const file of readdirSync(join(process.cwd(), "schemas")).filter((f) => f.endsWith(".ts"))) {
    const mod: Record<string, unknown> = await import(`../schemas/${file.slice(0, -3)}.ts`);
    for (const [name, value] of Object.entries(mod)) {
      if (UPDATE_SCHEMA_NAME.test(name) && value instanceof z.ZodType) found.set(name, value);
    }
  }
  return found;
}

describe("no update schema declares a default", () => {
  it("discovers exactly the published update schemas, each with a row in the table (and no row without a schema)", async () => {
    const found = await discoverUpdateSchemas();
    expect(found.size).toBe(EXPECTED_UPDATE_SCHEMAS);
    expect([...found.keys()].sort()).toEqual(Object.keys(MINIMAL).sort());
  });

  it("the minimal parse of every discovered schema leaves every other key undefined", async () => {
    // Redundant with the per-schema degenerate cases above on purpose: a new
    // `.default()` on any update schema shows up here as a defined value.
    for (const [name, schema] of await discoverUpdateSchemas()) {
      const row = MINIMAL[name];
      const result = schema.safeParse(row.input);
      expect(result.success, name).toBe(true);
      if (result.success) expect(definedKeys(result.data as object, row.defined), name).toEqual([]);
    }
  });
});
