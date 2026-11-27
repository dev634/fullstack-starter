import { describe, it, expect, vi, beforeEach } from "vitest";

// F7 (fix/televersements): updateSettings (name and colors) and uploadLogo / removeLogo (logo) used to write
// each other's columns with a copy read a moment earlier, so whichever committed last undid the other. They now
// write DISJOINT columns. This is the repository half: the SQL columns each writer names, nothing else.
vi.mock("@/lib/prisma", () => ({
  prisma: { appSettings: { upsert: vi.fn(), update: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { upsert, updateLogo } from "@/repository/appSettings";

const upsertMock = vi.mocked(prisma.appSettings.upsert);
const updateMock = vi.mocked(prisma.appSettings.update);

beforeEach(() => vi.clearAllMocks());

describe("the branding writer and the logo writer name disjoint columns", () => {
  it("upsert (name and colors) never names a logo column, in the update", async () => {
    await upsert({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222", updatedBy: "super@example.com" });
    const args = upsertMock.mock.calls[0][0];
    expect(Object.keys(args.update).sort()).toEqual(["accentColor", "appName", "primaryColor", "updatedBy"]);
    expect(args.update).not.toHaveProperty("logoUrl");
    expect(args.update).not.toHaveProperty("logoPublicId");
  });

  it("updateLogo writes the logo columns and the actor, and nothing of the branding", async () => {
    await updateLogo({ logoUrl: "https://res.cloudinary.com/new.png", logoPublicId: "app-settings/new", updatedBy: "super@example.com" });
    const args = updateMock.mock.calls[0][0];
    expect(args.where).toEqual({ id: 1 });
    expect(Object.keys(args.data).sort()).toEqual(["logoPublicId", "logoUrl", "updatedBy"]);
  });

  it("updateLogo clears the logo with null (the removal), never by omission", async () => {
    await updateLogo({ logoUrl: null, logoPublicId: null, updatedBy: "super@example.com" });
    expect(updateMock.mock.calls[0][0].data).toEqual({ logoUrl: null, logoPublicId: null, updatedBy: "super@example.com" });
  });

  it("a database failure is the repository's own opaque error, not Prisma's text", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    updateMock.mockRejectedValueOnce(new Error("connection refused: secret host"));
    await expect(updateLogo({ logoUrl: null, logoPublicId: null, updatedBy: "x" })).rejects.toEqual({
      type: "repositoryError",
      message: "Database Error updating the logo.",
    });
  });
});
