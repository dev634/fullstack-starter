import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createOrAccumulate } from "@/repository/projectMaterials";

/**
 * Manual material add must accumulate the same item instead of listing it
 * twice — same behaviour a delivery-note scan already has. "Same item" is
 * same project + same reference + same supplier.
 */

const TAG = "@material-accumulate-test.local";

async function makeProject() {
  const client = await prisma.client.create({
    data: {
      email: `c-${Date.now()}-${Math.random().toString(36).slice(2)}${TAG}`,
      companyName: "AccumulateCo",
      address: "1 Test St",
      city: "Testville",
      zipCode: "00000",
      country: "Testland",
      status: "PROSPECT",
    },
  });
  const project = await prisma.project.create({
    data: { clientId: client.id, name: "Accumulate project", status: "ETUDE" },
  });
  return project;
}

async function countMaterials(projectId: number) {
  return prisma.projectMaterial.count({ where: { projectId } });
}

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TAG } } });
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    await prisma.projectMaterial.deleteMany({ where: { projectId: { in: (await prisma.project.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((p) => p.id) } } });
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("createOrAccumulate against a real Postgres", () => {
  it("tops up the quantity of the same reference + supplier instead of adding a row", async () => {
    const project = await makeProject();
    const base = { projectId: project.id, name: "Panneau 400W", reference: "REF-400", supplierName: "SolarCo" };

    const first = await createOrAccumulate({ ...base, quantity: 10 });
    expect(first.accumulated).toBe(false);

    const second = await createOrAccumulate({ ...base, quantity: 5 });
    expect(second.accumulated).toBe(true);
    expect(second.material.id).toBe(first.material.id);
    expect(second.material.quantity).toBe(15);

    expect(await countMaterials(project.id)).toBe(1);
  });

  it("keeps a different supplier as its own line, same reference notwithstanding", async () => {
    const project = await makeProject();
    await createOrAccumulate({ projectId: project.id, name: "Panneau", reference: "REF-400", supplierName: "SolarCo", quantity: 10 });
    const other = await createOrAccumulate({ projectId: project.id, name: "Panneau", reference: "REF-400", supplierName: "AutreFournisseur", quantity: 3 });

    expect(other.accumulated).toBe(false);
    expect(await countMaterials(project.id)).toBe(2);
  });

  it("keeps a different reference as its own line, same supplier notwithstanding", async () => {
    const project = await makeProject();
    await createOrAccumulate({ projectId: project.id, name: "Panneau 400", reference: "REF-400", supplierName: "SolarCo", quantity: 10 });
    const other = await createOrAccumulate({ projectId: project.id, name: "Panneau 500", reference: "REF-500", supplierName: "SolarCo", quantity: 4 });

    expect(other.accumulated).toBe(false);
    expect(await countMaterials(project.id)).toBe(2);
  });

  it("never accumulates when there is no reference — that isn't a reliable key", async () => {
    // Two unreferenced items from the same supplier are almost certainly
    // different things; merging them would be worse than a duplicate row.
    const project = await makeProject();
    await createOrAccumulate({ projectId: project.id, name: "Visserie", reference: "", supplierName: "SolarCo", quantity: 10 });
    const second = await createOrAccumulate({ projectId: project.id, name: "Câble", reference: "", supplierName: "SolarCo", quantity: 20 });

    expect(second.accumulated).toBe(false);
    expect(await countMaterials(project.id)).toBe(2);
  });

  it("matches on the same reference across a supplier that is null on both sides", async () => {
    const project = await makeProject();
    await createOrAccumulate({ projectId: project.id, name: "Item", reference: "REF-X", quantity: 2 });
    const second = await createOrAccumulate({ projectId: project.id, name: "Item", reference: "REF-X", quantity: 3 });

    expect(second.accumulated).toBe(true);
    expect(second.material.quantity).toBe(5);
    expect(await countMaterials(project.id)).toBe(1);
  });

  it("scopes the match to the project — the same reference in another project is separate", async () => {
    const a = await makeProject();
    const b = await makeProject();
    await createOrAccumulate({ projectId: a.id, name: "Item", reference: "REF-1", supplierName: "S", quantity: 1 });
    const inB = await createOrAccumulate({ projectId: b.id, name: "Item", reference: "REF-1", supplierName: "S", quantity: 1 });

    expect(inB.accumulated).toBe(false);
    expect(await countMaterials(a.id)).toBe(1);
    expect(await countMaterials(b.id)).toBe(1);
  });
});
