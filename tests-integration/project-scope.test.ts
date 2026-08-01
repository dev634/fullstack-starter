import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { search as searchProjects, findByClient } from "@/repository/projects";
import { search as searchClients } from "@/repository/clients";
import { findAccessScopeByEmail } from "@/repository/users";

/**
 * Row-level scoping, against a real Postgres.
 *
 * The point of these is the filtering happens in the QUERY. Hiding rows in the
 * render is what the section-visibility feature used to do, and it meant the
 * data was still fetched and every other surface leaked it.
 */

const TEST_DOMAIN = "@project-scope-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeCompanyWithProjects(companyName: string, projectNames: string[]) {
  const client = await prisma.client.create({
    data: {
      email: uniqueEmail("client"),
      companyName,
      address: "1 Test St",
      city: "Testville",
      zipCode: "00000",
      country: "Testland",
      status: "PROSPECT",
    },
  });
  const projects = [];
  for (const name of projectNames) {
    projects.push(
      await prisma.project.create({ data: { clientId: client.id, name, status: "ETUDE" } })
    );
  }
  return { client, projects };
}

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  await prisma.jobFunction.deleteMany({ where: { name: { startsWith: "ScopeTest" } } });
});

describe("project scoping by job function", () => {
  it("an ASSIGNED function only resolves the projects the user holds", async () => {
    const { projects } = await makeCompanyWithProjects("ScopedCo", ["Chantier A", "Chantier B"]);
    const fn = await prisma.jobFunction.create({
      data: { name: `ScopeTest chef ${Date.now()}`, projectScope: "ASSIGNED" },
    });
    const email = uniqueEmail("chef");
    await prisma.user.create({
      data: {
        email,
        password: "x",
        role: "EDITOR",
        jobFunctionId: fn.id,
        assignedProjects: { connect: [{ id: projects[0].id }] },
      },
    });

    const scope = await findAccessScopeByEmail(email);
    expect(scope?.projectScope).toBe("ASSIGNED");
    expect(scope?.assignedProjectIds).toEqual([projects[0].id]);
  });

  it("an ALL function reports no restriction, whatever the assignments", async () => {
    const { projects } = await makeCompanyWithProjects("OpenCo", ["Chantier A"]);
    const fn = await prisma.jobFunction.create({
      data: { name: `ScopeTest direction ${Date.now()}`, projectScope: "ALL" },
    });
    const email = uniqueEmail("direction");
    await prisma.user.create({
      data: {
        email,
        password: "x",
        role: "EDITOR",
        jobFunctionId: fn.id,
        assignedProjects: { connect: [{ id: projects[0].id }] },
      },
    });

    const scope = await findAccessScopeByEmail(email);
    expect(scope?.projectScope).toBe("ALL");
  });

  it("a user with no job function is unrestricted", async () => {
    // Nobody must lose access merely because their job title hasn't been set.
    const email = uniqueEmail("sansfonction");
    await prisma.user.create({ data: { email, password: "x", role: "EDITOR" } });

    const scope = await findAccessScopeByEmail(email);
    expect(scope?.projectScope).toBe("ALL");
  });

  it("the project search returns only the allowlisted ids", async () => {
    const { projects } = await makeCompanyWithProjects("SearchCo", ["Zzyxvis un", "Zzyxvis deux"]);

    const all = await searchProjects({ q: "Zzyxvis" });
    expect(all.projects.length).toBe(2);

    const scoped = await searchProjects({ q: "Zzyxvis", projectIds: [projects[0].id] });
    expect(scoped.projects.map((p) => p.id)).toEqual([projects[0].id]);
  });

  it("an empty allowlist yields nothing — it must not read as 'unrestricted'", async () => {
    // The bug this guards: `projectIds && {...}` would treat [] as falsy and
    // silently hand back every project to someone assigned to none.
    await makeCompanyWithProjects("EmptyCo", ["Zzyxempty un"]);

    const scoped = await searchProjects({ q: "Zzyxempty", projectIds: [] });
    expect(scoped.projects).toEqual([]);
  });

  it("the company search only returns companies reached through an allowed project", async () => {
    const a = await makeCompanyWithProjects("ZzyxAlpha SARL", ["Chantier alpha"]);
    await makeCompanyWithProjects("ZzyxBeta SARL", ["Chantier beta"]);

    const all = await searchClients({ q: "Zzyx" });
    expect(all.clients.length).toBe(2);

    const scoped = await searchClients({ q: "Zzyx", projectIds: [a.projects[0].id] });
    expect(scoped.clients.map((c) => c.companyName)).toEqual(["ZzyxAlpha SARL"]);
  });

  it("a company's project list is filtered too, not just the company list", async () => {
    // Reaching a company through one chantier must not expose its others.
    const { client, projects } = await makeCompanyWithProjects("MixedCo", ["Visible", "Cachée"]);

    const unrestricted = await findByClient(client.id);
    expect(unrestricted.length).toBe(2);

    const scoped = await findByClient(client.id, [projects[0].id]);
    expect(scoped.map((p) => p.name)).toEqual(["Visible"]);
  });
});
