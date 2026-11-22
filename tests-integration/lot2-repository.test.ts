import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { findTrashState as findProjectTrashState } from "@/repository/projects";
import {
  findTrashState as findClientTrashState,
  findReachableOptions,
  search as searchClients,
} from "@/repository/clients";
import { setContactProjects, hasLinkOutside } from "@/repository/contacts";
import { remove as removeUser, updatePassword, setUserProjects, createResetToken, markResetTokenUsed } from "@/repository/users";

/**
 * Lot 2, against a real Postgres: the new repository reads that the guards in
 * lib/access.ts and the actions stand on. Mocked unit tests cannot say whether
 * the SQL answers what the guard assumes.
 */

const TAG = "@lot2-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TAG}`;
}

async function makeCompany(name = "Lot2Co") {
  return prisma.client.create({
    data: { email: uniqueEmail("co"), companyName: name, address: "1 St", city: "Ville", zipCode: "00000", country: "FR", status: "PROSPECT" },
  });
}
function makeProject(clientId: number, name: string, deletedAt: Date | null = null) {
  return prisma.project.create({ data: { clientId, name, status: "ETUDE", deletedAt } });
}

afterEach(async () => {
  const clients = await prisma.client.findMany({ where: { email: { endsWith: TAG } } });
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    await prisma.contact.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.project.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TAG } } });
});

describe("findTrashState (project) — behind requireProjectAccess / requireTrashedProjectAccess", () => {
  it("absent -> null", async () => {
    expect(await findProjectTrashState(2_147_000_000)).toBeNull();
  });

  it("a live project of a live company is not in the trash", async () => {
    const co = await makeCompany();
    const p = await makeProject(co.id, "Live");
    expect(await findProjectTrashState(p.id)).toEqual({ selfTrashed: false, inTrash: false });
  });

  it("a trashed project is selfTrashed and inTrash", async () => {
    const co = await makeCompany();
    const p = await makeProject(co.id, "Trashed", new Date());
    expect(await findProjectTrashState(p.id)).toEqual({ selfTrashed: true, inTrash: true });
  });

  it("a LIVE project under a trashed company is inTrash but NOT selfTrashed (the trash does not cascade)", async () => {
    const co = await makeCompany();
    const p = await makeProject(co.id, "Live under trashed co");
    await prisma.client.update({ where: { id: co.id }, data: { deletedAt: new Date() } });
    expect(await findProjectTrashState(p.id)).toEqual({ selfTrashed: false, inTrash: true });
  });
});

describe("findTrashState (client) — behind requireClientAccess", () => {
  it("absent -> null; live -> not in trash; trashed -> in trash", async () => {
    expect(await findClientTrashState(2_147_000_000)).toBeNull();
    const co = await makeCompany();
    expect(await findClientTrashState(co.id)).toEqual({ inTrash: false });
    await prisma.client.update({ where: { id: co.id }, data: { deletedAt: new Date() } });
    expect(await findClientTrashState(co.id)).toEqual({ inTrash: true });
  });
});

describe("findReachableOptions — the add-project picker carries the same guard as addProject", () => {
  it("unrestricted: every LIVE company (a company with no project at all included), projected to {id, companyName}", async () => {
    const empty = await makeCompany("Lot2 empty");
    const trashed = await makeCompany("Lot2 trashed");
    await prisma.client.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    const options = await findReachableOptions(undefined);
    const mine = options.filter((o) => o.id === empty.id || o.id === trashed.id);
    expect(mine).toEqual([{ id: empty.id, companyName: "Lot2 empty" }]);
    expect(Object.keys(mine[0]).sort()).toEqual(["companyName", "id"]);
  });

  it("restricted: only companies with a LIVE project among the ids — not trashed projects, not other companies, not an empty company", async () => {
    const reach = await makeCompany("Lot2 reachable");
    const other = await makeCompany("Lot2 other");
    const empty = await makeCompany("Lot2 no project");
    const trashedOnly = await makeCompany("Lot2 trashed-project-only");
    const mine = await makeProject(reach.id, "Mine");
    await makeProject(other.id, "Not mine");
    const trashedMine = await makeProject(trashedOnly.id, "Mine but trashed", new Date());

    const options = await findReachableOptions([mine.id, trashedMine.id]);
    const ids = options.map((o) => o.id);
    expect(ids).toContain(reach.id);
    expect(ids).not.toContain(other.id);
    expect(ids).not.toContain(empty.id);
    expect(ids).not.toContain(trashedOnly.id);
  });

  it("restricted with an EMPTY allowlist: nothing", async () => {
    await makeCompany("Lot2 any");
    expect(await findReachableOptions([])).toEqual([]);
  });

  it("offers exactly what the company search offers the same caller (shared predicate)", async () => {
    const reach = await makeCompany("Lot2 shared");
    const p = await makeProject(reach.id, "P");
    const { clients } = await searchClients({ projectIds: [p.id], pageSize: 50 });
    const options = await findReachableOptions([p.id]);
    expect(options.map((o) => o.id).sort()).toEqual(clients.map((c) => c.id).sort());
  });
});

describe("setContactProjects — touches only the links the caller can edit", () => {
  async function setup() {
    const co = await makeCompany();
    const other = await makeCompany("Lot2 other co");
    const mine = await makeProject(co.id, "Mine");
    const hidden = await makeProject(co.id, "Hidden (out of scope)");
    const trashed = await makeProject(co.id, "Trashed", new Date());
    const foreign = await makeProject(other.id, "Other company");
    const contact = await prisma.contact.create({ data: { clientId: co.id, firstName: "A", lastName: "B" } });
    const linked = async () =>
      (await prisma.contact.findUniqueOrThrow({ where: { id: contact.id }, select: { projects: { select: { id: true } } } }))
        .projects.map((p) => p.id)
        .sort((a, b) => a - b);
    return { co, mine, hidden, trashed, foreign, contact, linked };
  }

  it("a restricted caller's save keeps the links it cannot see (out of scope, trashed) and edits its own", async () => {
    const { mine, hidden, trashed, contact, linked } = await setup();
    await prisma.contact.update({ where: { id: contact.id }, data: { projects: { set: [{ id: hidden.id }, { id: trashed.id }, { id: mine.id }] } } });

    // The form (which only shows `mine`) is saved with the box UNchecked.
    await setContactProjects(contact.id, [], [mine.id]);
    expect(await linked()).toEqual([hidden.id, trashed.id].sort((a, b) => a - b));

    // ... and checked again.
    await setContactProjects(contact.id, [mine.id], [mine.id]);
    expect(await linked()).toEqual([mine.id, hidden.id, trashed.id].sort((a, b) => a - b));
  });

  it("a forged id outside the caller's scope, in the trash, or in another company is never linked", async () => {
    const { mine, hidden, trashed, foreign, contact, linked } = await setup();
    await setContactProjects(contact.id, [hidden.id, trashed.id, foreign.id, mine.id], [mine.id]);
    expect(await linked()).toEqual([mine.id]);
  });

  it("degenerate row: a contact with no link at all, submitted nothing -> still no link", async () => {
    const { contact, linked } = await setup();
    await setContactProjects(contact.id, [], [2_147_000_001]);
    expect(await linked()).toEqual([]);
  });

  it("unrestricted (undefined scope): edits every LIVE project of the company, keeps the trashed link", async () => {
    const { mine, hidden, trashed, foreign, contact, linked } = await setup();
    await prisma.contact.update({ where: { id: contact.id }, data: { projects: { set: [{ id: trashed.id }] } } });
    await setContactProjects(contact.id, [mine.id, hidden.id, foreign.id], undefined);
    expect(await linked()).toEqual([mine.id, hidden.id, trashed.id].sort((a, b) => a - b));
  });
});

describe("hasLinkOutside — deleteContact for a restricted caller", () => {
  it("no link at all -> false; all links inside -> false; one outside (trashed included) -> true", async () => {
    const co = await makeCompany();
    const a = await makeProject(co.id, "A");
    const b = await makeProject(co.id, "B");
    const t = await makeProject(co.id, "T", new Date());
    const contact = await prisma.contact.create({ data: { clientId: co.id, firstName: "A", lastName: "B" } });

    expect(await hasLinkOutside(contact.id, [a.id])).toBe(false);
    await prisma.contact.update({ where: { id: contact.id }, data: { projects: { set: [{ id: a.id }] } } });
    expect(await hasLinkOutside(contact.id, [a.id])).toBe(false);
    await prisma.contact.update({ where: { id: contact.id }, data: { projects: { set: [{ id: a.id }, { id: b.id }] } } });
    expect(await hasLinkOutside(contact.id, [a.id])).toBe(true);
    await prisma.contact.update({ where: { id: contact.id }, data: { projects: { set: [{ id: a.id }, { id: t.id }] } } });
    expect(await hasLinkOutside(contact.id, [a.id])).toBe(true);
    expect(await hasLinkOutside(contact.id, [a.id, t.id])).toBe(false);
  });
});

describe("user repository writes never hand back a credential (F5)", () => {
  async function makeUser() {
    return prisma.user.create({ data: { email: uniqueEmail("u"), password: "$2b$10$secrethashsecrethash", role: "EDITOR" } });
  }
  const noCredential = (row: unknown) => {
    const json = JSON.stringify(row);
    expect(json).not.toContain("secrethash");
    expect(json).not.toMatch(/"password"/);
    expect(json).not.toMatch(/"token"/);
  };

  it("remove, updatePassword, setUserProjects, createResetToken and markResetTokenUsed return no password or token", async () => {
    const u = await makeUser();
    noCredential(await updatePassword(u.id, "$2b$10$secrethashsecrethash"));
    noCredential(await setUserProjects(u.id, []));
    const token = await createResetToken(u.id, "raw-token", new Date(Date.now() + 60_000));
    noCredential(token);
    noCredential(await markResetTokenUsed(token.id));
    const removed = await removeUser(u.id);
    noCredential(removed);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
  });
});
