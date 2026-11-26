import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { create, isPhotoUrlReferenced } from "@/repository/clients";

/**
 * repository/clients.ts::isPhotoUrlReferenced, against the real database: the compensation
 * in actions/clients/clients.ts destroys an uploaded photo after an unclassified write error
 * ONLY when this answers false. A trashed company still keeps its photo (restore), so it counts.
 */

const TEST_DOMAIN = "@photo-ref-integration.local";
const unique = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function payload(email: string, photoUrl: string | null) {
  return {
    email,
    companyName: "PhotoRefCo",
    address: "1 Test St",
    city: "Testville",
    zipCode: "00000",
    country: "Testland",
    photoUrl,
    phone: null,
    website: null,
    status: "PROSPECT" as const,
  };
}

afterEach(async () => {
  await prisma.client.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
});

describe("isPhotoUrlReferenced, against the real database", () => {
  it("is true while a company row carries the URL, false for a URL no row carries", async () => {
    const url = `https://res.cloudinary.com/demo/image/upload/v1/clients/${unique("kept")}.jpg`;
    await create(payload(`${unique("a")}${TEST_DOMAIN}`, url));
    await expect(isPhotoUrlReferenced(url)).resolves.toBe(true);
    await expect(isPhotoUrlReferenced(`${url}.other`)).resolves.toBe(false);
  });

  it("counts a company in the trash (its photo is kept for the restore)", async () => {
    const url = `https://res.cloudinary.com/demo/image/upload/v1/clients/${unique("trashed")}.jpg`;
    const { id } = await create(payload(`${unique("b")}${TEST_DOMAIN}`, url));
    await prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await expect(isPhotoUrlReferenced(url)).resolves.toBe(true);
  });
});
