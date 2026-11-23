import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create as createClient } from "@/repository/clients";
import { create as createProject, update as updateProject } from "@/repository/projects";
import { create as createEquipment } from "@/repository/equipment";
import { create as createLoan, update as updateLoan } from "@/repository/equipmentLoans";

/**
 * "Absent is not empty" against a real Postgres (lot 5b): an UPDATE that omits
 * a field must leave the column alone, an explicit null must clear it, a value
 * must set it. The unit tests assert what the repository hands to Prisma; this
 * proves Prisma and the database do what that contract assumes (undefined is
 * ignored, null is written), on the real constraints (the loan note CHECK).
 */

const TEST_DOMAIN = "@partial-writes-integration-test.local";
const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;

afterEach(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    await prisma.equipmentLoan.deleteMany({ where: { borrowerId: { in: userIds } } });
    await prisma.equipment.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TEST_DOMAIN } }, select: { id: true } });
  const clientIds = clients.map((c) => c.id);
  if (clientIds.length) {
    await prisma.project.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  }
});

describe("projects.update against a real Postgres", () => {
  async function seedProject() {
    const client = await createClient({
      email: uniqueEmail("client"), companyName: "PartialCo", address: "1 Test St", city: "Testville",
      zipCode: "00000", country: "Testland", photoUrl: null, phone: null, website: null, status: "PROSPECT",
    });
    return createProject({
      clientId: client.id, name: "Toiture", status: "EN_COURS", type: "OMBRIERE", businessNumber: "AFF-1",
      power: 9.5, budget: 1000, address: "2 rue X", startDate: "2026-06-01", endDate: "2026-06-30", notes: "note",
    });
  }

  it("absent -> every column unchanged (type and status keep their value, no default is written)", async () => {
    const created = await seedProject();
    await updateProject(created.id, {});
    const after = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(after).toMatchObject({
      name: "Toiture", status: "EN_COURS", type: "OMBRIERE", businessNumber: "AFF-1", power: 9.5, budget: 1000,
      address: "2 rue X", notes: "note",
    });
    expect(after.startDate).toEqual(created.startDate);
    expect(after.endDate).toEqual(created.endDate);
  });

  it("null -> cleared, and only what was named", async () => {
    const created = await seedProject();
    await updateProject(created.id, { businessNumber: null, power: null, startDate: null, notes: null });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(after).toMatchObject({ businessNumber: null, power: null, startDate: null, notes: null });
    expect(after).toMatchObject({ name: "Toiture", status: "EN_COURS", type: "OMBRIERE", budget: 1000, address: "2 rue X" });
    expect(after.endDate).toEqual(created.endDate);
  });

  it("value -> value", async () => {
    const created = await seedProject();
    await updateProject(created.id, { name: "Ombrière", status: "TERMINE", budget: 0, endDate: "2026-07-15" });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(after).toMatchObject({ name: "Ombrière", status: "TERMINE", budget: 0, power: 9.5 });
    expect(after.endDate).toEqual(new Date("2026-07-15"));
  });
});

describe("equipmentLoans.update against a real Postgres", () => {
  async function seedLoan() {
    const owner = await prisma.user.create({ data: { email: uniqueEmail("owner"), password: "x", role: "EDITOR" } });
    const borrower = await prisma.user.create({ data: { email: uniqueEmail("borrower"), password: "x", role: "EDITOR" } });
    const equipment = await createEquipment({ ownerId: owner.id, name: "Perceuse" });
    return createLoan({
      equipmentId: equipment.id, borrowerId: borrower.id, lentAt: "2026-02-01", dueAt: "2026-02-10", note: "Rendre vendredi",
    });
  }

  it("absent -> dueAt and note unchanged", async () => {
    const loan = await seedLoan();
    await updateLoan(loan.id, {});
    const after = await prisma.equipmentLoan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.note).toBe("Rendre vendredi");
    expect(after.dueAt).toEqual(new Date("2026-02-10"));
  });

  it("null -> cleared (the CHECK accepts NULL as the one 'none'), the other column untouched", async () => {
    const loan = await seedLoan();
    await updateLoan(loan.id, { note: null });
    let after = await prisma.equipmentLoan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.note).toBeNull();
    expect(after.dueAt).toEqual(new Date("2026-02-10"));

    await updateLoan(loan.id, { dueAt: null });
    after = await prisma.equipmentLoan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.dueAt).toBeNull();
    expect(after.note).toBeNull();
  });

  it("value -> value", async () => {
    const loan = await seedLoan();
    await updateLoan(loan.id, { dueAt: "2026-03-01", note: "Autre note" });
    const after = await prisma.equipmentLoan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.note).toBe("Autre note");
    expect(after.dueAt).toEqual(new Date("2026-03-01"));
  });
});
