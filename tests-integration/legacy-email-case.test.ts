import { describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/service/auth";
import { findByEmail, createResetToken, findValidResetToken, updatePassword, create } from "@/repository/users";

/**
 * Lookups by e-mail are EXACT on the canonical form (trimmed, lower-cased):
 * a case-insensitive match would be an unescaped ILIKE, where `_` and `%` are
 * wildcards (see tests-integration/email-lookup-wildcards.test.ts). So:
 *   - an account written through the application (normalized) signs in and
 *     resets whatever the casing typed;
 *   - a row with capitals can no longer exist: the lot 3 migration normalized
 *     the data (0 such rows measured in production) and added a CHECK, so the
 *     lookups' exactness has no legacy row left to miss.
 */

const TAG = `legacy-${Date.now()}`;
const DOMAIN = `@${TAG}.local`;
const LEGACY = `Jean.Dupont@${TAG.toUpperCase()}.local`;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN, mode: "insensitive" } } });
});

describe("e-mail lookups are exact on the canonical form (lot 5a, point 6)", () => {
  it("a normalized account signs in, with any casing of the address typed", async () => {
    const made = await create({ email: `New.Person${DOMAIN}`, name: "N", role: "VIEWER", password: await bcrypt.hash("password123", 10) }, null);
    expect(made.email).toBe(`new.person${DOMAIN}`);
    for (const typed of [`New.Person${DOMAIN}`, `new.person${DOMAIN}`, `NEW.PERSON${DOMAIN}`]) {
      const user = await verifyCredentials({ email: typed, password: "password123" });
      expect(user, typed).not.toBeNull();
      expect(user?.id).toBe(String(made.id));
      expect(user?.sessionVersion).toBe(0);
    }
    expect(await verifyCredentials({ email: `new.person${DOMAIN}`, password: "wrong-password" })).toBeNull();
  });

  it("and resets its password", async () => {
    const row = await findByEmail(`New.Person${DOMAIN}`);
    expect(row).not.toBeNull();
    await createResetToken(row!.id, "tok-exact-email", new Date(Date.now() + 60_000));
    expect((await findValidResetToken("tok-exact-email"))?.userId).toBe(row!.id);
    await updatePassword(row!.id, await bcrypt.hash("another-password1", 10));
    expect(await verifyCredentials({ email: `new.person${DOMAIN}`, password: "another-password1" })).not.toBeNull();
  });

  it("a row with capitals can no longer exist: the database refuses it (migration 20261123100000, User_email_normalized_check)", async () => {
    // Until lot 3 this test created such a row and showed the lookups missing
    // it. The migration normalized the data and added the CHECK, so the premise
    // is gone: what is left to prove is that the filet holds.
    await expect(
      prisma.user.create({ data: { email: LEGACY, name: "J", password: await bcrypt.hash("password123", 10), role: "EDITOR" } })
    ).rejects.toThrow(/User_email_normalized_check/);
    expect(await findByEmail(LEGACY)).toBeNull();
  });
});
