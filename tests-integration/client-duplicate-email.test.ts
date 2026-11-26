import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create, update } from "@/repository/clients";
import { getErrorMessage } from "@/lib/helpers";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * A P2002 on Client can only be the unique index on `email` (the only unique
 * constraint besides the primary key — checked in the migrations). create AND
 * update must both throw the same i18n code, and getErrorMessage must resolve
 * it to the dictionary string in each locale — never the hard-coded English one.
 */

const TEST_DOMAIN = "@dup-email-integration.local";
const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;

function payload(email: string) {
  return {
    email,
    companyName: "DupCo",
    address: "1 Test St",
    city: "Testville",
    zipCode: "00000",
    country: "Testland",
    photoUrl: null,
    phone: null,
    website: null,
    status: "PROSPECT" as const,
  };
}

const fr = getDictionary("fr");
const en = getDictionary("en");

afterEach(async () => {
  await prisma.client.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
});

describe("duplicate Client.email, against the real database", () => {
  it("the unique index on email is the only unique constraint of Client besides its primary key", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'Client' AND indexdef LIKE 'CREATE UNIQUE%'`;
    const defs = rows.map((r) => r.indexdef);
    expect(defs).toHaveLength(2);
    expect(defs.some((d) => d.includes("(email)"))).toBe(true);
    expect(defs.some((d) => d.includes("(id)"))).toBe(true);
  });

  it("create: the second insert with the same e-mail throws the code, rendered in French then English", async () => {
    const email = uniqueEmail("create");
    await create(payload(email));
    const refusal = await create(payload(email)).then(
      () => null,
      (e: unknown) => e
    );
    expect(refusal).toMatchObject({ type: "databaseError", i18n: "duplicateClientEmail" });
    expect(getErrorMessage(refusal, fr.errors.serverError, fr)).toBe(fr.clients.messages.duplicateEmail);
    expect(getErrorMessage(refusal, en.errors.serverError, en)).toBe(en.clients.messages.duplicateEmail);
    expect(fr.clients.messages.duplicateEmail).not.toBe(en.clients.messages.duplicateEmail);
  });

  it("update: moving to an e-mail already taken throws the same code, and leaves the row unchanged", async () => {
    const taken = uniqueEmail("taken");
    const mine = uniqueEmail("mine");
    await create(payload(taken));
    const { id } = await create(payload(mine));

    const refusal = await update({ id, email: taken, photoUrl: undefined }).then(
      () => null,
      (e: unknown) => e
    );
    expect(refusal).toMatchObject({ type: "databaseError", i18n: "duplicateClientEmail" });
    expect(getErrorMessage(refusal, fr.errors.serverError, fr)).toBe(fr.clients.messages.duplicateEmail);
    expect(getErrorMessage(refusal, en.errors.serverError, en)).toBe(en.clients.messages.duplicateEmail);

    const row = await prisma.client.findUnique({ where: { id }, select: { email: true } });
    expect(row?.email).toBe(mine);
  });

  it("update: keeping its own e-mail (a normal save) is not a conflict", async () => {
    const email = uniqueEmail("self");
    const { id } = await create(payload(email));
    await expect(update({ id, email, companyName: "Renamed", photoUrl: undefined })).resolves.toMatchObject({ id });
  });
});
