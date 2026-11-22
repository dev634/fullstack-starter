import { describe, it, expect } from "vitest";
import {
  MIN_DATE_YEAR,
  MAX_DATE_YEAR,
  isValidIsoDate,
  isValidIsoInstant,
  optionalDateField,
  requiredDateField,
  requiredDateTimeField,
} from "@/schemas/fields";
import { createProjectSchema, updateProjectSchema } from "@/schemas/project";
import { createTaskSchema } from "@/schemas/task";
import { createInterventionSchema } from "@/schemas/intervention";
import { lendEquipmentSchema, returnLoanSchema, editLoanSchema } from "@/schemas/equipmentLoan";
import { datetimeLocalToIso } from "@/lib/datetimeLocal";

describe("isValidIsoDate (F9)", () => {
  it.each(["2026-06-15", "2026-02-28", "2028-02-29", "1900-01-01", "2100-12-31"])("accepts %s", (v) => {
    expect(isValidIsoDate(v)).toBe(true);
  });

  it.each([
    "2026-02-30", // not a calendar date (Date.parse rolls it over)
    "2027-02-29", // not a leap year
    "2026-13-01",
    "2026-00-10",
    "2026-06-00",
    "2026-6-5", // not zero-padded
    "15/06/2026", // not ISO
    "2026-06-15T10:00", // a date field takes a date
    "20260615",
    "",
    " 2026-06-15",
    "1899-12-31", // below MIN_DATE_YEAR
    "2101-01-01", // above MAX_DATE_YEAR
    "0026-06-15",
    "275760-09-13",
  ])("refuses %j", (v) => {
    expect(isValidIsoDate(v)).toBe(false);
  });

  it("year bounds are the documented constants", () => {
    expect([MIN_DATE_YEAR, MAX_DATE_YEAR]).toEqual([1900, 2100]);
  });
});

describe("isValidIsoInstant (F9)", () => {
  it("accepts what the browser form actually sends (datetimeLocalToIso)", () => {
    const sent = datetimeLocalToIso("2026-08-01T09:30");
    expect(sent).toMatch(/Z$/);
    expect(isValidIsoInstant(sent)).toBe(true);
  });

  it.each(["2026-08-01T07:30:00.000Z", "2026-08-01T07:30Z", "2026-08-01T09:30:00+02:00"])("accepts %s", (v) => {
    expect(isValidIsoInstant(v)).toBe(true);
  });

  it.each([
    "2026-08-01T09:30", // no zone: ambiguous, the browser converts first
    "2026-02-30T09:30:00Z",
    "2026-08-01T24:00:00Z",
    "2026-08-01T09:60:00Z",
    "2026-08-01",
    "2026-08-01 09:30:00Z",
    "1800-08-01T09:30:00Z",
    "2200-08-01T09:30:00Z",
    "",
  ])("refuses %j", (v) => {
    expect(isValidIsoInstant(v)).toBe(false);
  });
});

describe("date field schemas", () => {
  it("optional: blank means not provided, a bad value is refused", () => {
    expect(optionalDateField.safeParse(undefined)).toMatchObject({ success: true, data: undefined });
    expect(optionalDateField.safeParse("  ")).toMatchObject({ success: true, data: undefined });
    expect(optionalDateField.safeParse("2026-02-30").success).toBe(false);
  });

  it("required: blank and invalid are both refused", () => {
    expect(requiredDateField.safeParse("").success).toBe(false);
    expect(requiredDateField.safeParse("2026-02-30").success).toBe(false);
    expect(requiredDateField.safeParse("2026-06-15").success).toBe(true);
    expect(requiredDateTimeField.safeParse("").success).toBe(false);
  });
});

const project = { clientId: "1", name: "Toiture" };

describe("project dates: start <= end (F9), create and update", () => {
  it("accepts start before, equal to, or without the other bound", () => {
    expect(createProjectSchema.safeParse({ ...project, startDate: "2026-06-01", endDate: "2026-06-30" }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...project, startDate: "2026-06-01", endDate: "2026-06-01" }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...project, startDate: "2026-06-01" }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...project, endDate: "2026-06-01" }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...project, startDate: "", endDate: "" }).success).toBe(true);
  });

  it("refuses an end before the start, with the error on endDate", () => {
    const res = createProjectSchema.safeParse({ ...project, startDate: "2026-06-30", endDate: "2026-06-01" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path.join("."))).toEqual(["endDate"]);
  });

  it("the same rule holds on update", () => {
    const bad = updateProjectSchema.safeParse({ id: "3", ...project, startDate: "2026-06-30", endDate: "2026-06-01" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path.join("."))).toEqual(["endDate"]);
    expect(updateProjectSchema.safeParse({ id: "3", ...project, startDate: "2026-06-01", endDate: "2026-06-30" }).success).toBe(true);
  });

  it("an invalid date is reported once, on its own field, not also as an ordering error", () => {
    const res = createProjectSchema.safeParse({ ...project, startDate: "2026-02-30", endDate: "2026-06-01" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path.join("."))).toEqual(["startDate"]);
  });

  it("refuses an out-of-range year", () => {
    expect(createProjectSchema.safeParse({ ...project, startDate: "0026-06-01" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...project, endDate: "20260-06-01" }).success).toBe(false);
  });
});

describe("the other schemas use the shared primitive", () => {
  it("task dueDate", () => {
    const task = { projectId: "1", clientId: "1", title: "T" };
    expect(createTaskSchema.safeParse({ ...task, dueDate: "2026-06-15" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...task, dueDate: "" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...task, dueDate: "2026-02-30" }).success).toBe(false);
  });

  it("intervention scheduledAt takes the browser's ISO instant, not a bare datetime-local", () => {
    const base = { projectId: "1", clientId: "1", description: "d" };
    expect(createInterventionSchema.safeParse({ ...base, scheduledAt: datetimeLocalToIso("2026-08-01T09:30") }).success).toBe(true);
    expect(createInterventionSchema.safeParse({ ...base, scheduledAt: "2026-02-30T09:30:00.000Z" }).success).toBe(false);
  });

  it("loans keep their ordering guard (due >= lent) and gain the strict format", () => {
    const lend = { equipmentId: "1", borrowerId: "2", lentAt: "2026-06-15" };
    expect(lendEquipmentSchema.safeParse({ ...lend, dueAt: "2026-06-15" }).success).toBe(true);
    const early = lendEquipmentSchema.safeParse({ ...lend, dueAt: "2026-06-14" });
    expect(early.success).toBe(false);
    if (!early.success) expect(early.error.issues[0].path).toEqual(["dueAt"]);
    expect(lendEquipmentSchema.safeParse({ ...lend, lentAt: "2026-02-30" }).success).toBe(false);
    expect(returnLoanSchema.safeParse({ id: "1", returnedAt: "2026-02-30" }).success).toBe(false);
    expect(returnLoanSchema.safeParse({ id: "1", returnedAt: "2026-06-15" }).success).toBe(true);
    expect(editLoanSchema.safeParse({ id: "1", dueAt: "" }).success).toBe(true);
    expect(editLoanSchema.safeParse({ id: "1", dueAt: "2101-01-01" }).success).toBe(false);
  });
});
