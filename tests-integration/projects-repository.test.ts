import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create as createProject, search } from "@/repository/projects";
import { create as createClient, softDelete } from "@/repository/clients";

const TEST_DOMAIN = "@projects-integration-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeClient(overrides: { companyName?: string } = {}) {
  return createClient({
    firstName: "Int",
    lastName: "Test",
    email: uniqueEmail("client"),
    companyName: overrides.companyName ?? "IntegrationCo",
    address: "1 Test St",
    city: "Testville",
    zipCode: "00000",
    country: "Testland",
    photoUrl: null,
    phone: null,
    website: null,
    status: "PROSPECT",
  });
}

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("projects repository search() against a real Postgres", () => {
  it("matches by project name, case-insensitively", async () => {
    const client = await makeClient();
    await createProject({ clientId: client.id, name: "Zzyxqui rooftop", status: "ETUDE" });

    const { projects } = await search({ q: "zzyxqui" });
    expect(projects.some((p) => p.clientId === client.id)).toBe(true);
  });

  it("matches by the owning client's company name", async () => {
    const client = await makeClient({ companyName: "Zzyxqui Solaire SARL" });
    await createProject({ clientId: client.id, name: "Ombrière", status: "ETUDE" });

    const { projects } = await search({ q: "zzyxqui solaire" });
    expect(projects.some((p) => p.clientId === client.id)).toBe(true);
  });

  it("excludes projects whose client is in the trash", async () => {
    const client = await makeClient({ companyName: "TrashedForSearchTest" });
    await createProject({ clientId: client.id, name: "Projet fantôme", status: "ETUDE" });

    const before = await search({ q: "Projet fantôme" });
    expect(before.projects.length).toBeGreaterThan(0);

    await softDelete(client.id);
    const after = await search({ q: "Projet fantôme" });
    expect(after.projects.length).toBe(0);
  });
});
