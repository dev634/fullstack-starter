import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyScanItems, isUnmatchedScanMaterialError } from "@/repository/projectMaterials";

/**
 * Passe 3a, point 2: applyScanItems must never report success (nor leave
 * stock partially touched) when one of the batch's materialId's matches no
 * row in this project. Only a real transaction against Postgres actually
 * proves the rollback — a mocked prisma client can't.
 */

const TAG = "@apply-scan-items-test.local";

async function makeProject() {
  const client = await prisma.client.create({
    data: {
      email: `c-${Date.now()}-${Math.random().toString(36).slice(2)}${TAG}`,
      companyName: "ApplyScanCo",
      address: "1 Test St",
      city: "Testville",
      zipCode: "00000",
      country: "Testland",
      status: "PROSPECT",
    },
  });
  const project = await prisma.project.create({
    data: { clientId: client.id, name: "Apply scan project", status: "ETUDE" },
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
    const projectIds = (
      await prisma.project.findMany({ where: { clientId: { in: ids } }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.projectMaterial.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("applyScanItems against a real Postgres", () => {
  it("applies the whole batch (increment + create) when every materialId resolves in this project", async () => {
    const project = await makeProject();
    const existing = await prisma.projectMaterial.create({
      data: { projectId: project.id, name: "Onduleur", quantity: 3 },
    });

    await applyScanItems(
      project.id,
      [
        { materialId: existing.id, name: existing.name, quantity: 5 },
        { name: "Panneau 400W", quantity: 10, reference: "REF-1" },
      ],
      "Rexel"
    );

    const updated = await prisma.projectMaterial.findUnique({ where: { id: existing.id } });
    expect(updated?.quantity).toBe(8);
    expect(await countMaterials(project.id)).toBe(2);
  });

  it("rolls back the WHOLE batch — including an otherwise-valid increment — when one materialId belongs to another project", async () => {
    const project = await makeProject();
    const otherProject = await makeProject();
    const ownMaterial = await prisma.projectMaterial.create({
      data: { projectId: project.id, name: "Onduleur", quantity: 3 },
    });
    const foreignMaterial = await prisma.projectMaterial.create({
      data: { projectId: otherProject.id, name: "Câble", quantity: 20 },
    });

    const attempt = applyScanItems(project.id, [
      { materialId: ownMaterial.id, name: ownMaterial.name, quantity: 5 },
      { materialId: foreignMaterial.id, name: foreignMaterial.name, quantity: 2 },
    ]);

    await expect(attempt).rejects.toSatisfy((error: unknown) => isUnmatchedScanMaterialError(error));
    await expect(attempt).rejects.toMatchObject({ materialId: foreignMaterial.id });

    // The bug this test guards against: the FIRST item's updateMany, on its
    // own, WOULD have succeeded (ownMaterial really is in this project) — a
    // batch reported as "Stock mis à jour" used to leave exactly this kind
    // of half-applied state. Both rows must be untouched.
    const ownAfter = await prisma.projectMaterial.findUnique({ where: { id: ownMaterial.id } });
    const foreignAfter = await prisma.projectMaterial.findUnique({ where: { id: foreignMaterial.id } });
    expect(ownAfter?.quantity).toBe(3);
    expect(foreignAfter?.quantity).toBe(20);
  });

  it("rolls back the whole batch — including a new-material create — when a materialId no longer exists at all", async () => {
    const project = await makeProject();

    const attempt = applyScanItems(project.id, [
      { name: "Panneau 400W", quantity: 10, reference: "REF-1" },
      { materialId: 999_999_999, name: "Ghost", quantity: 1 },
    ]);

    await expect(attempt).rejects.toSatisfy((error: unknown) => isUnmatchedScanMaterialError(error));
    expect(await countMaterials(project.id)).toBe(0);
  });
});
