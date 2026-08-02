import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createResetToken, findValidResetToken } from "@/repository/users";
import { hashResetToken } from "@/lib/resetToken";

/**
 * Password-reset tokens must be stored hashed (ASVS): the DB must never hold a
 * value that, if read, would let someone take over an account.
 */

const TAG = "@reset-token-test.local";

async function makeUser() {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}${TAG}`,
      password: "x",
      role: "EDITOR",
    },
  });
}

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TAG } } });
});

describe("reset token storage against a real Postgres", () => {
  it("stores the hash, not the raw token", async () => {
    const user = await makeUser();
    const raw = "raw-token-" + Math.random().toString(36).slice(2);
    await createResetToken(user.id, raw, new Date(Date.now() + 3600_000));

    const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(row?.token).toBe(hashResetToken(raw));
    expect(row?.token).not.toBe(raw);
  });

  it("finds a valid token when presented with the RAW value", async () => {
    const user = await makeUser();
    const raw = "raw-token-" + Math.random().toString(36).slice(2);
    await createResetToken(user.id, raw, new Date(Date.now() + 3600_000));

    const found = await findValidResetToken(raw);
    expect(found?.userId).toBe(user.id);
  });

  it("does not match when the stored hash is presented as if it were the token", async () => {
    // Someone who read the DB holds the hash, not a usable token: presenting
    // the hash must not authenticate the reset.
    const user = await makeUser();
    const raw = "raw-token-" + Math.random().toString(36).slice(2);
    await createResetToken(user.id, raw, new Date(Date.now() + 3600_000));

    const found = await findValidResetToken(hashResetToken(raw));
    expect(found).toBeNull();
  });
});
