import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateProfile, resetPasswordWithToken, createResetToken } from "@/repository/users";

/**
 * Lot 3: a new password or a new role kills the account's existing sessions, by
 * bumping User.sessionVersion IN THE SAME STATEMENT as the write that motivates
 * it (lib/sessionGate.ts compares it to the token's). Each case reads the value
 * back from the database after ONE repository call: a bump issued as a second
 * statement would pass a "ends at +1" check only by luck, and is excluded by
 * tests/account-writers-coverage.test.ts (same `data`).
 *
 * Not bumped on purpose: a name alone, a job function alone (the function is
 * re-read on every request, it is not in the token).
 */

const DOMAIN = "@session-version-bump.local";

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.jobFunction.deleteMany({ where: { name: { startsWith: "svb-" } } });
});

async function makeUser(tag: string) {
  return prisma.user.create({
    data: { email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${DOMAIN}`, name: "Before", password: "old-hash", role: "EDITOR" },
  });
}

async function versionOf(id: number) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { sessionVersion: true } });
  return row.sessionVersion;
}

describe("sessionVersion is bumped by the writers of the password and the role", () => {
  it("a new account starts at 0", async () => {
    const user = await makeUser("fresh");
    expect(await versionOf(user.id)).toBe(0);
  });

  it("updateProfile with a password: +1, and the password is written", async () => {
    const user = await makeUser("pwd");
    await updateProfile(user.id, { name: "Before", role: "EDITOR", jobFunctionId: null, password: "new-hash" }, null);
    expect(await versionOf(user.id)).toBe(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    expect(row.password).toBe("new-hash");
  });

  it("updateProfile with a different role: +1, and the role is written", async () => {
    const user = await makeUser("role");
    await updateProfile(user.id, { name: "Before", role: "VIEWER", jobFunctionId: null }, null);
    expect(await versionOf(user.id)).toBe(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true } });
    expect(row.role).toBe("VIEWER");
  });

  it("updateProfile with a password AND a role: +1, not +2 (one statement, one bump)", async () => {
    const user = await makeUser("both");
    await updateProfile(user.id, { name: "Before", role: "ADMIN", jobFunctionId: null, password: "new-hash" }, null);
    expect(await versionOf(user.id)).toBe(1);
  });

  it("updateProfile with the SAME role and no password (a name alone): unchanged", async () => {
    const user = await makeUser("name");
    await updateProfile(user.id, { name: "After", role: "EDITOR", jobFunctionId: null }, null);
    expect(await versionOf(user.id)).toBe(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    expect(row.name).toBe("After");
  });

  it("updateProfile changing the job function alone: unchanged", async () => {
    const user = await makeUser("fn");
    const fn = await prisma.jobFunction.create({ data: { name: `svb-${Date.now()}` } });
    await updateProfile(user.id, { name: "Before", role: "EDITOR", jobFunctionId: fn.id }, null);
    expect(await versionOf(user.id)).toBe(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { jobFunctionId: true } });
    expect(row.jobFunctionId).toBe(fn.id);
  });

  it("two successive password changes: +2 in total", async () => {
    const user = await makeUser("twice");
    await updateProfile(user.id, { name: "Before", role: "EDITOR", jobFunctionId: null, password: "h1" }, null);
    await updateProfile(user.id, { name: "Before", role: "EDITOR", jobFunctionId: null, password: "h2" }, null);
    expect(await versionOf(user.id)).toBe(2);
  });

  it("resetPasswordWithToken (the reset flow): +1, and the password is written", async () => {
    const user = await makeUser("reset");
    await createResetToken(user.id, `raw-${user.id}`, new Date(Date.now() + 60_000));
    expect(await resetPasswordWithToken(`raw-${user.id}`, "reset-hash")).toBe(true);
    expect(await versionOf(user.id)).toBe(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    expect(row.password).toBe("reset-hash");
  });

  describe("the reset link is claimed atomically (resetPasswordWithToken)", () => {
    const unused = (userId: number) => prisma.passwordResetToken.count({ where: { userId, usedAt: null } });

    it("a second use of the same link is refused and writes nothing (no second bump)", async () => {
      const user = await makeUser("twice-link");
      const raw = `raw-twice-${user.id}`;
      await createResetToken(user.id, raw, new Date(Date.now() + 60_000));
      expect(await resetPasswordWithToken(raw, "h1")).toBe(true);
      expect(await resetPasswordWithToken(raw, "h2")).toBe(false);
      expect(await versionOf(user.id)).toBe(1);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
      expect(row.password).toBe("h1");
    });

    it("two concurrent submissions of the same link: exactly one wins", async () => {
      const user = await makeUser("race");
      const raw = `raw-race-${user.id}`;
      await createResetToken(user.id, raw, new Date(Date.now() + 60_000));
      const results = await Promise.all([resetPasswordWithToken(raw, "a"), resetPasswordWithToken(raw, "b")]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await versionOf(user.id)).toBe(1);
    });

    it("an expired or unknown link is refused and writes nothing", async () => {
      const user = await makeUser("expired");
      await createResetToken(user.id, `raw-exp-${user.id}`, new Date(Date.now() - 1000));
      expect(await resetPasswordWithToken(`raw-exp-${user.id}`, "h")).toBe(false);
      expect(await resetPasswordWithToken("never-issued", "h")).toBe(false);
      expect(await versionOf(user.id)).toBe(0);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
      expect(row.password).toBe("old-hash");
    });

    it("a reset deletes the account's other unused links, and ONLY its own (a neighbour's link survives)", async () => {
      const neighbour = await makeUser("neighbour");
      await createResetToken(neighbour.id, `raw-nb-${neighbour.id}`, new Date(Date.now() + 60_000));
      const user = await makeUser("others");
      await createResetToken(user.id, `raw-o1-${user.id}`, new Date(Date.now() + 60_000));
      // Minted by hand: createResetToken itself keeps a single unused link.
      await prisma.passwordResetToken.create({ data: { userId: user.id, token: `other-${user.id}`, expiresAt: new Date(Date.now() + 60_000) } });
      expect(await resetPasswordWithToken(`raw-o1-${user.id}`, "h")).toBe(true);
      expect(await unused(user.id)).toBe(0);
      expect(await unused(neighbour.id)).toBe(1);
    });

    it("updateProfile with a password deletes the account's unused links; without one, it keeps them", async () => {
      const neighbour = await makeUser("profile-neighbour");
      await createResetToken(neighbour.id, `raw-pn-${neighbour.id}`, new Date(Date.now() + 60_000));
      const user = await makeUser("profile-links");
      await createResetToken(user.id, `raw-p-${user.id}`, new Date(Date.now() + 60_000));
      await updateProfile(user.id, { name: "Other", role: "EDITOR", jobFunctionId: null }, null);
      expect(await unused(user.id)).toBe(1);
      await updateProfile(user.id, { name: "Other", role: "EDITOR", jobFunctionId: null, password: "h" }, null);
      expect(await unused(user.id)).toBe(0);
      expect(await unused(neighbour.id)).toBe(1);
    });
  });
});
