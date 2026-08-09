import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  search as searchProjects,
  findByClient,
  hasProjectAmong,
  findClientIdsAmong,
  findTrashed as findTrashedProjects,
} from "@/repository/projects";
import { search as searchClients, findTrashed as findTrashedClients, getDashboardStats } from "@/repository/clients";
import { findAccessScopeByEmail } from "@/repository/users";
import { logActivity as logProjectActivity, listActivity as listProjectActivity } from "@/repository/projectActivity";
import { logActivity as logClientActivity, listActivity as listClientActivity } from "@/repository/activity";

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
  // ActivityLog/ProjectActivityLog carry no FK to Client/Project (they must
  // survive a permanent delete), so cleaning up the owning row above doesn't
  // remove these — clean them up explicitly by their distinctive actorEmail.
  await prisma.activityLog.deleteMany({ where: { actorEmail: { endsWith: TEST_DOMAIN } } });
  await prisma.projectActivityLog.deleteMany({ where: { actorEmail: { endsWith: TEST_DOMAIN } } });
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

  describe("hasProjectAmong (requireClientAccess, docs/PENTEST-2026-08.md F1)", () => {
    it("is true when one of the client's projects is in the allowed set", async () => {
      const { client, projects } = await makeCompanyWithProjects("ZzyxReachable SARL", ["Chantier X"]);
      await expect(hasProjectAmong(client.id, [projects[0].id])).resolves.toBe(true);
    });

    it("is false for a client reached only through a DIFFERENT company's project id", async () => {
      const a = await makeCompanyWithProjects("ZzyxOwn SARL", ["Chantier own"]);
      const b = await makeCompanyWithProjects("ZzyxForeign SARL", ["Chantier foreign"]);
      // The caller's allowed set is company A's project — company B must stay unreachable.
      await expect(hasProjectAmong(b.client.id, [a.projects[0].id])).resolves.toBe(false);
    });

    it("is false for an empty allowed set", async () => {
      const { client } = await makeCompanyWithProjects("ZzyxEmptySet SARL", ["Chantier"]);
      await expect(hasProjectAmong(client.id, [])).resolves.toBe(false);
    });

    it("ignores a trashed project — it must not keep a client reachable once its only project is gone", async () => {
      const { client, projects } = await makeCompanyWithProjects("ZzyxTrashed SARL", ["Chantier trashed"]);
      await prisma.project.update({ where: { id: projects[0].id }, data: { deletedAt: new Date() } });
      await expect(hasProjectAmong(client.id, [projects[0].id])).resolves.toBe(false);
    });
  });
});

describe("trash listings are scoped like the live ones (adversarial pass 1, #2)", () => {
  it("findTrashed (projects) only returns the allowlisted ids", async () => {
    const { projects } = await makeCompanyWithProjects("ZzyxTrashScope SARL", ["Chantier visible", "Chantier caché"]);
    await prisma.project.update({ where: { id: projects[0].id }, data: { deletedAt: new Date() } });
    await prisma.project.update({ where: { id: projects[1].id }, data: { deletedAt: new Date() } });

    const scoped = await findTrashedProjects([projects[0].id]);
    expect(scoped.some((p) => p.id === projects[0].id)).toBe(true);
    expect(scoped.some((p) => p.id === projects[1].id)).toBe(false);

    // An empty allowlist must read as "nothing", not "unrestricted".
    const empty = await findTrashedProjects([]);
    expect(empty.some((p) => p.id === projects[0].id || p.id === projects[1].id)).toBe(false);
  });

  it("findTrashed (clients) only surfaces a trashed company reached through a live allowed project", async () => {
    // Trashing a company doesn't cascade to its projects — this one stays
    // live, so a restricted user assigned to it retains the same
    // "can reach this company" relationship restoreClient/permanentlyDeleteClient
    // already grant them via hasProjectAmong.
    const { client, projects } = await makeCompanyWithProjects("ZzyxTrashScopeMine SARL", ["Chantier toujours vivant"]);
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });

    const other = await makeCompanyWithProjects("ZzyxTrashScopeOther SARL", ["Autre chantier"]);
    await prisma.client.update({ where: { id: other.client.id }, data: { deletedAt: new Date() } });

    const scoped = await findTrashedClients([projects[0].id]);
    expect(scoped.some((c) => c.id === client.id)).toBe(true);
    expect(scoped.some((c) => c.id === other.client.id)).toBe(false);

    const empty = await findTrashedClients([]);
    expect(empty.some((c) => c.id === client.id)).toBe(false);
  });
});

describe("activity logs are scoped like the live listings (adversarial pass 1, #3)", () => {
  it("project activity only returns entries for the allowlisted project ids", async () => {
    const { projects } = await makeCompanyWithProjects("ZzyxActivityScope SARL", ["Chantier A", "Chantier B"]);
    const actorEmail = uniqueEmail("actor");
    await logProjectActivity({ action: "CREATED", projectId: projects[0].id, projectName: projects[0].name, actorEmail });
    await logProjectActivity({ action: "CREATED", projectId: projects[1].id, projectName: projects[1].name, actorEmail });

    const scoped = await listProjectActivity(1, [projects[0].id]);
    expect(scoped.entries.some((e) => e.projectId === projects[0].id)).toBe(true);
    expect(scoped.entries.some((e) => e.projectId === projects[1].id)).toBe(false);

    const empty = await listProjectActivity(1, []);
    expect(empty.entries.some((e) => e.projectId === projects[0].id)).toBe(false);
  });

  it("client activity is scoped via the projects the caller can reach, not a direct clientId filter", async () => {
    const a = await makeCompanyWithProjects("ZzyxActivityAlpha SARL", ["Chantier alpha"]);
    const b = await makeCompanyWithProjects("ZzyxActivityBeta SARL", ["Chantier beta"]);
    const actorEmail = uniqueEmail("actor");
    await logClientActivity({ action: "CREATED", clientId: a.client.id, clientName: a.client.companyName, actorEmail });
    await logClientActivity({ action: "CREATED", clientId: b.client.id, clientName: b.client.companyName, actorEmail });

    const clientIds = await findClientIdsAmong([a.projects[0].id]);
    expect(clientIds).toEqual([a.client.id]);

    const scoped = await listClientActivity(1, clientIds);
    expect(scoped.entries.some((e) => e.clientId === a.client.id)).toBe(true);
    expect(scoped.entries.some((e) => e.clientId === b.client.id)).toBe(false);
  });
});

describe("home dashboard stats are scoped (adversarial pass 1, #6)", () => {
  it("counts and the recently-added list only cover companies reached through an allowed project", async () => {
    const a = await makeCompanyWithProjects("ZzyxDashAlpha SARL", ["Chantier alpha"]);
    await makeCompanyWithProjects("ZzyxDashBeta SARL", ["Chantier beta"]);

    const scoped = await getDashboardStats([a.projects[0].id]);
    expect(scoped.total).toBe(1);
    expect(scoped.recent.map((c) => c.companyName)).toEqual(["ZzyxDashAlpha SARL"]);

    const empty = await getDashboardStats([]);
    expect(empty.total).toBe(0);
    expect(empty.recent).toEqual([]);
  });
});
