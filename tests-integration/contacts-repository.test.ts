import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create as createContact, attachLogin, remove } from "@/repository/contacts";
import { create as createClient } from "@/repository/clients";

const TEST_DOMAIN = "@contacts-integration-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeClient() {
  return createClient({
    email: uniqueEmail("client"),
    companyName: "IntegrationCo",
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
    await prisma.contact.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
});

describe("contacts repository remove() against a real Postgres", () => {
  it("deletes the linked portal login (User) along with the contact", async () => {
    const client = await makeClient();
    const contact = await createContact({ clientId: client.id, firstName: "A", lastName: "B" });
    const user = await prisma.user.create({
      data: { email: uniqueEmail("portal"), password: "hashed", role: "CLIENT" },
    });
    await attachLogin(contact.id, user.id);

    await remove(contact.id);

    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("deletes a contact with no portal login without touching any User row", async () => {
    const client = await makeClient();
    const contact = await createContact({ clientId: client.id, firstName: "C", lastName: "D" });

    await expect(remove(contact.id)).resolves.toMatchObject({ id: contact.id });
    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).toBeNull();
  });
});
