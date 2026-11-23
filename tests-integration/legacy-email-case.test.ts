import { describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/service/auth";
import { findByEmail, findIdByEmail, createResetToken, findValidResetToken, updatePassword, create } from "@/repository/users";

/**
 * Lookups by e-mail are EXACT on the canonical form (trimmed, lower-cased):
 * a case-insensitive match would be an unescaped ILIKE, where `_` and `%` are
 * wildcards (see tests-integration/email-lookup-wildcards.test.ts). So:
 *   - an account written through the application (normalized) signs in and
 *     resets whatever the casing typed;
 *   - a row saved with capitals BEFORE normalization existed is NOT found by
 *     those lookups until the migration that normalizes it (lot 3, measured at
 *     0 such rows in production). This test says so on purpose: it is the
 *     documented limit, not a promise.
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

  it("a row saved with capitals before normalization is NOT matched until it is migrated", async () => {
    const row = await prisma.user.create({ data: { email: LEGACY, name: "J", password: await bcrypt.hash("password123", 10), role: "EDITOR" } });
    expect(row.email).not.toBe(row.email.toLowerCase());
    expect(await findByEmail(LEGACY)).toBeNull();
    expect(await findIdByEmail(LEGACY.toLowerCase())).toBeNull();
    expect(await verifyCredentials({ email: LEGACY.toLowerCase(), password: "password123" })).toBeNull();
  });
});
