import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create, search, findById, softDelete, restore, permanentlyRemove, findTrashed } from "@/repository/clients";
import { create as createContact, attachLogin } from "@/repository/contacts";

// A distinctive domain so cleanup can never touch real/seeded data.
const TEST_DOMAIN = "@integration-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

function basePayload(email: string, overrides: Partial<Parameters<typeof create>[0]> = {}) {
  return {
    email,
    companyName: "IntegrationCo",
    address: "1 Test St",
    city: "Testville",
    zipCode: "00000",
    country: "Testland",
    photoUrl: null,
    phone: null,
    website: null,
    status: "PROSPECT" as const,
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.client.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
});

describe("clients repository against a real Postgres", () => {
  it("creates a client and persists every field", async () => {
    const email = uniqueEmail("create");
    const created = await create(basePayload(email, { companyName: "Acme Integration" }));

    expect(created.id).toBeGreaterThan(0);
    const found = await findById(created.id);
    expect(found).toMatchObject({ email, companyName: "Acme Integration" });
  });

  it("enforces the unique email constraint at the database level", async () => {
    const email = uniqueEmail("dup");
    await create(basePayload(email));
    await expect(create(basePayload(email))).rejects.toMatchObject({ type: "databaseError" });
  });

  it("search() matches case-insensitively and excludes soft-deleted clients", async () => {
    const email = uniqueEmail("search");
    const created = await create(basePayload(email, { companyName: "Zzyxqui" }));

    const before = await search({ q: "zzyxqui" });
    expect(before.clients.some((c) => c.id === created.id)).toBe(true);

    await softDelete(created.id);
    const after = await search({ q: "zzyxqui" });
    expect(after.clients.some((c) => c.id === created.id)).toBe(false);
  });

  it("search() also matches an organisation by one of its contacts' names", async () => {
    const email = uniqueEmail("contact-search");
    const org = await create(basePayload(email, { companyName: "PlainCorp" }));
    await createContact({ clientId: org.id, firstName: "Wxyzoro", lastName: "Contactson" });

    const byFirstName = await search({ q: "wxyzoro" });
    expect(byFirstName.clients.some((c) => c.id === org.id)).toBe(true);

    // Once the org is trashed it must drop out even when the contact still matches.
    await softDelete(org.id);
    const after = await search({ q: "wxyzoro" });
    expect(after.clients.some((c) => c.id === org.id)).toBe(false);
  });

  it("soft-delete then restore round-trips deletedAt correctly", async () => {
    const email = uniqueEmail("trash");
    const created = await create(basePayload(email));

    await softDelete(created.id);
    expect((await findTrashed()).some((c) => c.id === created.id)).toBe(true);
    expect((await findById(created.id))?.deletedAt).not.toBeNull();

    await restore(created.id);
    expect((await findTrashed()).some((c) => c.id === created.id)).toBe(false);
    expect((await findById(created.id))?.deletedAt).toBeNull();
  });

  it("permanentlyRemove actually deletes the row", async () => {
    const email = uniqueEmail("perm");
    const created = await create(basePayload(email));

    await permanentlyRemove(created.id);
    expect(await findById(created.id)).toBeNull();
  });

  // Lot 5a: the contacts go by cascade, their CLIENT logins did not — a login
  // outliving its company kept a valid password and sessions.
  it("permanentlyRemove deletes the CLIENT logins of the company's contacts, and only those", async () => {
    const org = await create(basePayload(uniqueEmail("org")));
    const other = await create(basePayload(uniqueEmail("other-org")));
    const withLogin = await createContact({ clientId: org.id, firstName: "A", lastName: "A" });
    const noLogin = await createContact({ clientId: org.id, firstName: "B", lastName: "B" });
    const promoted = await createContact({ clientId: org.id, firstName: "C", lastName: "C" });
    const elsewhere = await createContact({ clientId: other.id, firstName: "D", lastName: "D" });
    const mk = (tag: string, role: "CLIENT" | "EDITOR") =>
      prisma.user.create({ data: { email: uniqueEmail(tag), password: "x", role } });
    const clientLogin = await mk("login", "CLIENT");
    const promotedUser = await mk("promoted", "EDITOR");
    const otherLogin = await mk("other-login", "CLIENT");
    await attachLogin(withLogin.id, clientLogin.id);
    await attachLogin(promoted.id, promotedUser.id);
    await attachLogin(elsewhere.id, otherLogin.id);

    await permanentlyRemove(org.id);

    expect(await findById(org.id)).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: noLogin.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: clientLogin.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: promotedUser.id } })).toMatchObject({ role: "EDITOR" });
    expect(await prisma.user.findUnique({ where: { id: otherLogin.id } })).toMatchObject({ role: "CLIENT" });
  });
});
