import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  create as createProject,
  findByIdForPortal,
  search,
  updateReserveStatusStyle,
} from "@/repository/projects";
import { create as createClient, softDelete } from "@/repository/clients";

const TEST_DOMAIN = "@projects-integration-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeClient(overrides: { companyName?: string } = {}) {
  return createClient({
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

describe("findByIdForPortal() against a real Postgres", () => {
  it("never selects budget or notes — the client portal deliberately never shows them", async () => {
    const client = await makeClient({ companyName: "PortalSelectTest" });
    const project = await createProject({
      clientId: client.id,
      name: "Toiture confidentielle",
      status: "ETUDE",
      budget: 42000,
      notes: "Marge interne : ne jamais montrer au client.",
    });

    const portalProject = await findByIdForPortal(project.id);

    expect(portalProject).not.toBeNull();
    expect(portalProject).not.toHaveProperty("budget");
    expect(portalProject).not.toHaveProperty("notes");
    // The fields the portal page does render must still come through.
    expect(portalProject).toMatchObject({
      id: project.id,
      clientId: client.id,
      name: "Toiture confidentielle",
      status: "ETUDE",
    });
  });

  it("returns null for an id that doesn't exist", async () => {
    const portalProject = await findByIdForPortal(-1);
    expect(portalProject).toBeNull();
  });

  // The four réserve status style columns are configured per-project and
  // read by the client portal's own réserves view — an allowlist select is
  // silent about a forgotten column (TS never flags it), so this is the one
  // place that would actually catch a regression there.
  it("does select the réserve status style columns, once configured", async () => {
    const client = await makeClient({ companyName: "PortalReserveStyleTest" });
    const project = await createProject({ clientId: client.id, name: "Toiture Sud", status: "ETUDE" });
    await updateReserveStatusStyle(project.id, {
      openLabel: "À traiter",
      openColor: "#ff8800",
      resolvedLabel: "Terminée",
      resolvedColor: "#059669",
    });

    const portalProject = await findByIdForPortal(project.id);

    expect(portalProject).toMatchObject({
      reserveOpenLabel: "À traiter",
      reserveOpenColor: "#ff8800",
      reserveResolvedLabel: "Terminée",
      reserveResolvedColor: "#059669",
    });
  });
});

describe("updateReserveStatusStyle() against a real Postgres", () => {
  it("persists all four columns, and NULL clears a column back to 'not configured'", async () => {
    const client = await makeClient({ companyName: "ReserveStatusStyleTest" });
    const project = await createProject({ clientId: client.id, name: "Ombrière Est", status: "ETUDE" });

    const configured = await updateReserveStatusStyle(project.id, {
      openLabel: "À traiter",
      openColor: "#ff8800",
      resolvedLabel: "Terminée",
      resolvedColor: "#059669",
    });
    expect(configured).toMatchObject({
      reserveOpenLabel: "À traiter",
      reserveOpenColor: "#ff8800",
      reserveResolvedLabel: "Terminée",
      reserveResolvedColor: "#059669",
    });

    const cleared = await updateReserveStatusStyle(project.id, {
      openLabel: null,
      openColor: null,
      resolvedLabel: "Terminée",
      resolvedColor: "#059669",
    });
    expect(cleared).toMatchObject({
      reserveOpenLabel: null,
      reserveOpenColor: null,
      reserveResolvedLabel: "Terminée",
      reserveResolvedColor: "#059669",
    });
  });

  it("only ever returns the four style columns plus id — never budget/notes", async () => {
    const client = await makeClient({ companyName: "ReserveStatusStyleSelectTest" });
    const project = await createProject({
      clientId: client.id,
      name: "Centrale Nord",
      status: "ETUDE",
      budget: 99000,
      notes: "Marge interne : ne jamais montrer au client.",
    });

    const updated = await updateReserveStatusStyle(project.id, {
      openLabel: "À traiter",
      openColor: "#ff8800",
      resolvedLabel: null,
      resolvedColor: null,
    });

    expect(updated).not.toHaveProperty("budget");
    expect(updated).not.toHaveProperty("notes");
    expect(Object.keys(updated).sort()).toEqual(
      ["id", "reserveOpenColor", "reserveOpenLabel", "reserveResolvedColor", "reserveResolvedLabel"].sort()
    );
  });

  // Belt-and-suspenders check on migration 20260823090000's own CHECK
  // constraints: Zod (schemas/reserve.ts) already rejects these upstream, but
  // this proves the database itself refuses them too — a psql session or an
  // admin script goes around Zod, never around a CHECK.
  it("rejects a blank label at the database level even if a caller bypasses Zod", async () => {
    const client = await makeClient({ companyName: "ReserveStatusStyleCheckTest" });
    const project = await createProject({ clientId: client.id, name: "Toiture Ouest", status: "ETUDE" });

    await expect(
      updateReserveStatusStyle(project.id, {
        openLabel: "   ",
        openColor: null,
        resolvedLabel: null,
        resolvedColor: null,
      })
    ).rejects.toBeTruthy();
  });

  it("rejects a malformed colour at the database level even if a caller bypasses Zod", async () => {
    const client = await makeClient({ companyName: "ReserveStatusStyleColorCheckTest" });
    const project = await createProject({ clientId: client.id, name: "Toiture Est", status: "ETUDE" });

    await expect(
      updateReserveStatusStyle(project.id, {
        openLabel: null,
        openColor: "not-a-color",
        resolvedLabel: null,
        resolvedColor: null,
      })
    ).rejects.toBeTruthy();
  });
});
