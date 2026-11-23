import { describe, it, expect, vi, beforeEach } from "vitest";

// One mocked delegate per model the updates below touch: what is asserted is
// the `data` each repository `update` hands to Prisma. Prisma IGNORES an
// `undefined` property and writes a `null` — so `undefined` = "column left
// alone" and `null` = "cleared" is exactly the contract under test.
const mocks = vi.hoisted(() => {
  const delegate = () => ({ update: vi.fn().mockResolvedValue({ id: 1 }), findUniqueOrThrow: vi.fn() });
  return {
    project: delegate(),
    projectMaterial: delegate(),
    contact: delegate(),
    equipment: delegate(),
    equipmentLoan: delegate(),
    intervention: delegate(),
    reserve: delegate(),
    projectTask: delegate(),
    client: delegate(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: mocks }));

import { update as updateProject, updateReserveStatusStyle } from "@/repository/projects";
import { update as updateMaterial } from "@/repository/projectMaterials";
import { update as updateContact } from "@/repository/contacts";
import { update as updateEquipment } from "@/repository/equipment";
import { update as updateLoan } from "@/repository/equipmentLoans";
import { update as updateIntervention } from "@/repository/interventions";
import { update as updateReserve } from "@/repository/reserves";
import { update as updateTask } from "@/repository/tasks";
import { update as updateClient } from "@/repository/clients";

type Delegate = { update: ReturnType<typeof vi.fn> };

function writtenData(delegate: Delegate): Record<string, unknown> {
  const call = delegate.update.mock.calls[0];
  if (!call) throw new Error("update was not called");
  return call[0].data;
}

/** The columns that are `undefined` (left alone) / `null` (cleared) in what was written. */
function leftAlone(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => data[k] === undefined).sort();
}
function cleared(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => data[k] === null).sort();
}

beforeEach(() => vi.clearAllMocks());

describe("projects.update", () => {
  const cols = ["address", "budget", "businessNumber", "endDate", "name", "notes", "power", "startDate", "status", "type"];

  it("absent -> every column left alone (no 'AUTRE' default over the type, nothing nulled)", async () => {
    await updateProject(1, {});
    const data = writtenData(mocks.project);
    expect(leftAlone(data)).toEqual(cols);
    expect(cleared(data)).toEqual([]);
  });

  it("null -> cleared (every nullable column)", async () => {
    await updateProject(1, { businessNumber: null, power: null, budget: null, address: null, startDate: null, endDate: null, notes: null });
    const data = writtenData(mocks.project);
    expect(cleared(data)).toEqual(["address", "budget", "businessNumber", "endDate", "notes", "power", "startDate"]);
    expect(leftAlone(data)).toEqual(["name", "status", "type"]);
  });

  it("value -> value (a Date for the dates, 0 kept)", async () => {
    await updateProject(1, { name: "T", type: "OMBRIERE", status: "EN_COURS", power: 9.5, budget: 0, address: "a", startDate: "2026-06-01", endDate: "2026-06-30", notes: "n", businessNumber: "B" });
    expect(writtenData(mocks.project)).toEqual({
      name: "T", type: "OMBRIERE", status: "EN_COURS", power: 9.5, budget: 0, address: "a", businessNumber: "B", notes: "n",
      startDate: new Date("2026-06-01"), endDate: new Date("2026-06-30"),
    });
  });
});

describe("projects.updateReserveStatusStyle", () => {
  it("absent -> left alone; null -> back to the default; value -> value", async () => {
    await updateReserveStatusStyle(1, {});
    expect(leftAlone(writtenData(mocks.project))).toEqual(["reserveOpenColor", "reserveOpenLabel", "reserveResolvedColor", "reserveResolvedLabel"]);

    mocks.project.update.mockClear();
    await updateReserveStatusStyle(1, { openLabel: null, openColor: null });
    const data = writtenData(mocks.project);
    expect(cleared(data)).toEqual(["reserveOpenColor", "reserveOpenLabel"]);
    expect(leftAlone(data)).toEqual(["reserveResolvedColor", "reserveResolvedLabel"]);

    mocks.project.update.mockClear();
    await updateReserveStatusStyle(1, { openLabel: "À traiter", resolvedColor: "#059669" });
    expect(writtenData(mocks.project)).toMatchObject({ reserveOpenLabel: "À traiter", reserveResolvedColor: "#059669" });
  });
});

describe("projectMaterials.update", () => {
  const cols = ["materialCategoryId", "name", "quantity", "reference", "requiredQuantity", "supplierName", "taskCategoryId", "taskGroupId", "taskId", "unit"];

  it("absent -> every column left alone, the link included", async () => {
    await updateMaterial(1, {});
    const data = writtenData(mocks.projectMaterial);
    expect(leftAlone(data)).toEqual(cols);
    expect(cleared(data)).toEqual([]);
  });

  it("null -> cleared", async () => {
    await updateMaterial(1, {
      unit: null, supplierName: null, reference: null, taskId: null, taskGroupId: null, taskCategoryId: null, requiredQuantity: null, materialCategoryId: null,
    });
    const data = writtenData(mocks.projectMaterial);
    expect(cleared(data)).toEqual(["materialCategoryId", "reference", "requiredQuantity", "supplierName", "taskCategoryId", "taskGroupId", "taskId", "unit"]);
    expect(leftAlone(data)).toEqual(["name", "quantity"]);
  });

  it("value -> value", async () => {
    await updateMaterial(1, { name: "C", quantity: 0, unit: "m", taskId: 5, requiredQuantity: 20, materialCategoryId: 2 });
    expect(writtenData(mocks.projectMaterial)).toMatchObject({ name: "C", quantity: 0, unit: "m", taskId: 5, requiredQuantity: 20, materialCategoryId: 2 });
  });
});

describe("contacts.update", () => {
  it("absent -> left alone; null -> cleared; value -> value", async () => {
    await updateContact(1, {});
    expect(leftAlone(writtenData(mocks.contact))).toEqual(["email", "firstName", "jobFunctionId", "lastName", "phone"]);
    expect(cleared(writtenData(mocks.contact))).toEqual([]);

    mocks.contact.update.mockClear();
    await updateContact(1, { email: null, phone: null, jobFunctionId: null });
    expect(cleared(writtenData(mocks.contact))).toEqual(["email", "jobFunctionId", "phone"]);
    expect(leftAlone(writtenData(mocks.contact))).toEqual(["firstName", "lastName"]);

    mocks.contact.update.mockClear();
    await updateContact(1, { firstName: "A", lastName: "B", email: "a@b.fr", phone: "06", jobFunctionId: 3 });
    expect(writtenData(mocks.contact)).toEqual({ firstName: "A", lastName: "B", email: "a@b.fr", phone: "06", jobFunctionId: 3 });
  });
});

describe("equipment.update", () => {
  it("absent -> name, reference and the photo pair left alone", async () => {
    await updateEquipment(1, {});
    const data = writtenData(mocks.equipment);
    expect(Object.keys(data).sort()).toEqual(["name", "reference"]);
    expect(leftAlone(data)).toEqual(["name", "reference"]);
  });

  it("null reference -> cleared; value -> value; the photo pair is written only when a photo change is requested", async () => {
    await updateEquipment(1, { reference: null });
    expect(writtenData(mocks.equipment).reference).toBeNull();

    mocks.equipment.update.mockClear();
    await updateEquipment(1, { name: "Perceuse", reference: "R1", photoUrl: null, photoPublicId: null });
    expect(writtenData(mocks.equipment)).toEqual({ name: "Perceuse", reference: "R1", photoUrl: null, photoPublicId: null });
  });
});

describe("equipmentLoans.update", () => {
  it("absent -> dueAt and note left alone", async () => {
    await updateLoan(1, {});
    const data = writtenData(mocks.equipmentLoan);
    expect(leftAlone(data)).toEqual(["dueAt", "note"]);
    expect(cleared(data)).toEqual([]);
  });

  it("null -> cleared; value -> value (a Date for dueAt)", async () => {
    await updateLoan(1, { dueAt: null, note: null });
    expect(cleared(writtenData(mocks.equipmentLoan))).toEqual(["dueAt", "note"]);

    mocks.equipmentLoan.update.mockClear();
    await updateLoan(1, { dueAt: "2026-02-01", note: "n" });
    expect(writtenData(mocks.equipmentLoan)).toEqual({ dueAt: new Date("2026-02-01"), note: "n" });
  });
});

describe("interventions.update", () => {
  it("absent -> everything left alone (no 'PLANIFIEE' default over the status)", async () => {
    await updateIntervention(1, {});
    expect(leftAlone(writtenData(mocks.intervention))).toEqual(["description", "scheduledAt", "status", "technician"]);
    expect(cleared(writtenData(mocks.intervention))).toEqual([]);
  });

  it("null technician -> cleared; value -> value (a Date for scheduledAt)", async () => {
    await updateIntervention(1, { technician: null });
    expect(cleared(writtenData(mocks.intervention))).toEqual(["technician"]);

    mocks.intervention.update.mockClear();
    await updateIntervention(1, { scheduledAt: "2026-08-01T07:30:00.000Z", description: "d", technician: "P", status: "FAITE" });
    expect(writtenData(mocks.intervention)).toEqual({ scheduledAt: new Date("2026-08-01T07:30:00.000Z"), description: "d", technician: "P", status: "FAITE" });
  });
});

describe("reserves.update", () => {
  it("absent -> everything left alone (no 'OPEN' default reopening a resolved réserve, no GPS wiped)", async () => {
    await updateReserve(1, {});
    expect(leftAlone(writtenData(mocks.reserve))).toEqual(["description", "latitude", "longitude", "status"]);
    expect(cleared(writtenData(mocks.reserve))).toEqual([]);
  });

  it("null coordinates -> cleared; 0 is a value", async () => {
    await updateReserve(1, { latitude: null, longitude: null });
    expect(cleared(writtenData(mocks.reserve))).toEqual(["latitude", "longitude"]);

    mocks.reserve.update.mockClear();
    await updateReserve(1, { description: "d", status: "RESOLVED", latitude: 0, longitude: 2.3 });
    expect(writtenData(mocks.reserve)).toEqual({ description: "d", status: "RESOLVED", latitude: 0, longitude: 2.3 });
  });
});

describe("tasks.update", () => {
  const plain = { id: 1, quantityTarget: null, quantityDone: null, done: false };
  const tracked = { id: 1, quantityTarget: 10, quantityDone: 4, done: false };

  it("absent -> title, dueDate and the whole quantity block left alone", async () => {
    mocks.projectTask.findUniqueOrThrow.mockResolvedValue(tracked);
    await updateTask(1, {});
    const data = writtenData(mocks.projectTask);
    expect(Object.keys(data).sort()).toEqual(["dueDate", "title"]);
    expect(leftAlone(data)).toEqual(["dueDate", "title"]);
  });

  it("null dueDate -> cleared; null quantityTarget -> the task reverts to a checkbox (done untouched)", async () => {
    mocks.projectTask.findUniqueOrThrow.mockResolvedValue(tracked);
    await updateTask(1, { dueDate: null, quantityTarget: null });
    const data = writtenData(mocks.projectTask);
    expect(cleared(data)).toEqual(["dueDate", "quantityDone", "quantityTarget"]);
    expect("done" in data).toBe(false);
  });

  it("value -> value; a new target re-clamps the progress and syncs done", async () => {
    mocks.projectTask.findUniqueOrThrow.mockResolvedValue(tracked);
    await updateTask(1, { title: "T", dueDate: "2026-06-01", quantityTarget: 3 });
    expect(writtenData(mocks.projectTask)).toEqual({
      title: "T", dueDate: new Date("2026-06-01"), quantityTarget: 3, quantityDone: 3, done: true,
    });
  });

  it("turning tracking on for a plain task that is already done starts from done", async () => {
    mocks.projectTask.findUniqueOrThrow.mockResolvedValue({ ...plain, done: true });
    await updateTask(1, { quantityTarget: 5 });
    expect(writtenData(mocks.projectTask)).toMatchObject({ quantityTarget: 5, quantityDone: 5, done: true });
  });
});

describe("clients.update", () => {
  it("absent -> every column left alone, the photo included", async () => {
    await updateClient({ id: 1 });
    const data = writtenData(mocks.client);
    expect(cleared(data)).toEqual([]);
    expect(Object.keys(data)).not.toContain("photoUrl");
    expect(leftAlone(data)).toEqual(["address", "city", "companyName", "country", "email", "phone", "status", "website", "zipCode"]);
  });

  it("null phone/website -> cleared; photoUrl null -> removed; value -> value", async () => {
    await updateClient({ id: 1, phone: null, website: null, photoUrl: null });
    expect(cleared(writtenData(mocks.client))).toEqual(["phone", "photoUrl", "website"]);

    mocks.client.update.mockClear();
    await updateClient({ id: 1, companyName: "ACME", phone: "01", status: "CLIENT" });
    expect(writtenData(mocks.client)).toMatchObject({ companyName: "ACME", phone: "01", status: "CLIENT" });
  });
});
