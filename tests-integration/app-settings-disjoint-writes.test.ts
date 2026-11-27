import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { upsert, updateLogo } from "@/repository/appSettings";

/**
 * F7 (fix/televersements), against the real database: the branding form (name, colors) and the logo
 * upload / removal write DISJOINT columns of the singleton row, so two requests in flight cannot undo
 * each other with a stale copy. The singleton is the application's own row: it is read first and put back after.
 */

type Snapshot = Awaited<ReturnType<typeof prisma.appSettings.findUnique>>;
let original: Snapshot = null;

beforeAll(async () => {
  original = await prisma.appSettings.findUnique({ where: { id: 1 } });
});

afterAll(async () => {
  if (!original) return;
  // Only the columns this file wrote.
  await prisma.appSettings.update({
    where: { id: original.id },
    data: {
      appName: original.appName,
      logoUrl: original.logoUrl,
      logoPublicId: original.logoPublicId,
      primaryColor: original.primaryColor,
      accentColor: original.accentColor,
      updatedBy: original.updatedBy,
    },
  });
});

describe("branding and logo writes, concurrent, on the real singleton row", () => {
  it("each of 25 rounds keeps BOTH changes, whichever write commits last", async () => {
    // The row is seeded by a migration: a database without it proves nothing, and must say so.
    expect(original).not.toBeNull();
    for (let round = 0; round < 25; round++) {
      const name = `Disjoint ${round}`;
      const logo = `https://res.cloudinary.com/demo/image/upload/disjoint-${round}.png`;
      await Promise.all([
        upsert({ appName: name, primaryColor: "#112233", accentColor: "#445566", updatedBy: "branding@test" }),
        updateLogo({ logoUrl: logo, logoPublicId: `disjoint/${round}`, updatedBy: "logo@test" }),
      ]);
      const row = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(row.appName).toBe(name);
      expect(row.primaryColor).toBe("#112233");
      expect(row.logoUrl).toBe(logo);
      expect(row.logoPublicId).toBe(`disjoint/${round}`);
    }
  });

  it("the branding write leaves a logo that was set before it, and the removal leaves the branding", async () => {
    expect(original).not.toBeNull();
    await updateLogo({ logoUrl: "https://res.cloudinary.com/demo/image/upload/kept.png", logoPublicId: "disjoint/kept", updatedBy: "logo@test" });
    await upsert({ appName: "Only branding", primaryColor: "#0a0b0c", accentColor: "#0d0e0f", updatedBy: "branding@test" });
    let row = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.logoPublicId).toBe("disjoint/kept");
    await updateLogo({ logoUrl: null, logoPublicId: null, updatedBy: "logo@test" });
    row = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.logoUrl).toBeNull();
    expect(row.appName).toBe("Only branding");
  });
});
