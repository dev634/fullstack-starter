import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create, search, findById, softDelete, restore, permanentlyRemove, findTrashed } from "@/repository/clients";

// A distinctive domain so cleanup can never touch real/seeded data.
const TEST_DOMAIN = "@integration-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

function basePayload(email: string, overrides: Partial<Parameters<typeof create>[0]> = {}) {
  return {
    firstName: "Int",
    lastName: "Test",
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
    const created = await create(basePayload(email, { firstName: "Zzyxqui" }));

    const before = await search({ q: "zzyxqui" });
    expect(before.clients.some((c) => c.id === created.id)).toBe(true);

    await softDelete(created.id);
    const after = await search({ q: "zzyxqui" });
    expect(after.clients.some((c) => c.id === created.id)).toBe(false);
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
});
