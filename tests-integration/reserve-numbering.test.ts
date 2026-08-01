import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create as createReserve, remove as removeReserve } from "@/repository/reserves";

/**
 * Réserve numbers are a citation, not a display detail: a snagging report sent
 * to a contractor says "réserve 7". These tests pin the two properties that
 * makes true — unique within a project, and never reused.
 */

const TEST_DOMAIN = "@reserve-numbering-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeProjectWithPlan() {
  const client = await prisma.client.create({
    data: {
      email: uniqueEmail("client"),
      companyName: "NumberingCo",
      address: "1 Test St",
      city: "Testville",
      zipCode: "00000",
      country: "Testland",
      status: "PROSPECT",
    },
  });
  const project = await prisma.project.create({
    data: { clientId: client.id, name: "Numbering project", status: "ETUDE" },
  });
  const plan = await prisma.reservePlan.create({
    data: {
      projectId: project.id,
      name: "Plan A",
      url: "https://res.cloudinary.com/demo/image/upload/v1/x.pdf",
      publicId: "x",
    },
  });
  return { client, project, plan };
}

function pin(planId: number, description: string) {
  return createReserve({ planId, x: 0.5, y: 0.5, description });
}

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("réserve numbering against a real Postgres", () => {
  it("numbers réserves from 1, incrementing within the project", async () => {
    const { plan } = await makeProjectWithPlan();

    const first = await pin(plan.id, "Fissure");
    const second = await pin(plan.id, "Infiltration");
    const third = await pin(plan.id, "Joint manquant");

    expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
  });

  it("never reuses the number of a deleted réserve", async () => {
    // The whole point: a report already sent cites "réserve 3". If deleting it
    // freed the number, a different défaut would later answer to that citation.
    const { plan } = await makeProjectWithPlan();
    await pin(plan.id, "Un");
    await pin(plan.id, "Deux");
    const third = await pin(plan.id, "Trois");

    await removeReserve(third.id);
    const next = await pin(plan.id, "Quatre");

    expect(next.number).toBe(4);
  });

  it("keeps numbering continuous across the project's plans, not per plan", async () => {
    const { project, plan } = await makeProjectWithPlan();
    const otherPlan = await prisma.reservePlan.create({
      data: {
        projectId: project.id,
        name: "Plan B",
        url: "https://res.cloudinary.com/demo/image/upload/v1/y.pdf",
        publicId: "y",
      },
    });

    const onA = await pin(plan.id, "Sur le plan A");
    const onB = await pin(otherPlan.id, "Sur le plan B");

    expect(onA.number).toBe(1);
    expect(onB.number).toBe(2);
  });

  it("restarts at 1 for a different project", async () => {
    const a = await makeProjectWithPlan();
    const b = await makeProjectWithPlan();

    const inA = await pin(a.plan.id, "Projet A");
    const inB = await pin(b.plan.id, "Projet B");

    expect(inA.number).toBe(1);
    expect(inB.number).toBe(1);
  });

  it("assigns distinct numbers when réserves are pinned concurrently", async () => {
    // Two people pinning at the same instant compute the same "max + 1"; the
    // unique constraint rejects the loser and the repository retries.
    const { plan } = await makeProjectWithPlan();

    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pin(plan.id, `Simultanée ${i}`))
    );

    const numbers = created.map((r) => r.number).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stamps the owning project on each réserve", async () => {
    const { project, plan } = await makeProjectWithPlan();
    const reserve = await pin(plan.id, "Contrôle");
    expect(reserve.projectId).toBe(project.id);
  });
});
