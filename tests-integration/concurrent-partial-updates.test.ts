import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { update as updateProject, type StoredProjectDates } from "@/repository/projects";
import { update as updateMaterial } from "@/repository/projectMaterials";

/**
 * Read-then-write races of partial updates, against a real Postgres (lot 5b).
 *
 * Two rules cannot live in a schema or a CHECK because they compare the payload
 * to the STORED row: a project's end must not precede its start when an update
 * sends only one bound, and a linked material must keep a required quantity when
 * an update sends no link. The actions read the stored side and write in ONE
 * transaction that holds the row (`SELECT … FOR UPDATE`, repository `update`'s
 * `accept`). Without the lock, two updates that each pass the check alone both
 * commit and break it together; these tests fire them with Promise.all, over
 * several rounds, and assert the invariant on the final row.
 */

const TEST_DOMAIN = "@concurrent-partial-updates-integration-test.local";
const ROUNDS = 12;

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TEST_DOMAIN } }, select: { id: true } });
  const clientIds = clients.map((c) => c.id);
  if (clientIds.length) {
    await prisma.project.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  }
});

async function seedProject(data: { startDate?: Date; endDate?: Date } = {}) {
  const client = await prisma.client.create({
    data: {
      email: `client-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`,
      companyName: "RaceCo",
      address: "1 Test St",
      city: "Testville",
      zipCode: "00000",
      country: "Testland",
      status: "PROSPECT",
    },
  });
  return prisma.project.create({ data: { clientId: client.id, name: "Race", status: "ETUDE", ...data } });
}

/** The action's own rule, as the `accept` it hands to the repository. */
const endNotBeforeStart =
  (startDate: string | undefined, endDate: string | undefined) =>
  (stored: StoredProjectDates): boolean => {
    const start = startDate ?? stored.startDate;
    const end = endDate ?? stored.endDate;
    return !(start && end && end < start);
  };

describe("updateProject: two partial updates that, together, would put the end before the start", () => {
  it("never leaves end < start, and exactly one of the two is refused", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const project = await seedProject({ startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
      // Each alone is fine (start 10-01 <= end 12-31; end 05-01 >= start 01-01); together they are not.
      const [a, b] = await Promise.all([
        updateProject(project.id, { startDate: "2026-10-01" }, endNotBeforeStart("2026-10-01", undefined)),
        updateProject(project.id, { endDate: "2026-05-01" }, endNotBeforeStart(undefined, "2026-05-01")),
      ]);
      const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(after.startDate && after.endDate && after.endDate >= after.startDate, `round ${round}`).toBe(true);
      expect([a, b].filter((r) => r === null), `round ${round}`).toHaveLength(1);
    }
  });
});

describe("editMaterial: linking and clearing the required quantity at the same time", () => {
  it("never leaves a linked material without a required quantity", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const project = await seedProject();
      const task = await prisma.projectTask.create({ data: { projectId: project.id, title: "Poser" } });
      const material = await prisma.projectMaterial.create({
        data: { projectId: project.id, name: "Panneau", quantity: 3, requiredQuantity: 5 },
      });
      await Promise.all([
        // the edit that LINKS (the schema makes it carry a required quantity)
        updateMaterial(material.id, { taskId: task.id, requiredQuantity: 5 }),
        // the edit that CLEARS the quantity from a payload with no link: refused if the row is linked
        updateMaterial(material.id, { requiredQuantity: null }, (stored) => !stored.linked),
      ]);
      const after = await prisma.projectMaterial.findUniqueOrThrow({ where: { id: material.id } });
      const linked = after.taskId !== null || after.taskGroupId !== null || after.taskCategoryId !== null;
      expect(!linked || after.requiredQuantity !== null, `round ${round}`).toBe(true);
    }
  });
});
