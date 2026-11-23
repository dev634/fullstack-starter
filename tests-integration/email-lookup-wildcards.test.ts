import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  findByEmail,
  findIdByEmail,
  findAccessScopeByEmail,
  findAccountJobFunctionByEmail,
  findSessionAccount,
} from "@/repository/users";
import { findByUserEmail } from "@/repository/contacts";

/**
 * Non-regression: Prisma's `mode: "insensitive"` becomes `"email" ILIKE $1`
 * WITHOUT escaping `%` and `_`. `_` is common in addresses and passes the
 * `.email()` of zod, so "jean_dupont@x.fr" used to be able to resolve to the
 * account "jean.dupont@x.fr" (smaller id), and "%" to any account. Every lookup
 * by e-mail must return the right account only, and a wildcard input nothing.
 */

const TAG = `wild-${Date.now()}`;
const DOMAIN = `@${TAG}.local`;
const DOT = `jean.dupont${DOMAIN}`; // created first: the smaller id
const UNDERSCORE = `jean_dupont${DOMAIN}`;

let dotId = 0;
let underscoreId = 0;

beforeAll(async () => {
  const a = await prisma.user.create({ data: { email: DOT, name: "Dot", password: "x", role: "EDITOR" } });
  const b = await prisma.user.create({ data: { email: UNDERSCORE, name: "Underscore", password: "x", role: "EDITOR" } });
  dotId = a.id;
  underscoreId = b.id;
  expect(dotId).toBeLessThan(underscoreId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
});

describe("e-mail lookups return the right account only", () => {
  it("each address resolves to its own account, on every reader", async () => {
    for (const [email, id] of [[DOT, dotId], [UNDERSCORE, underscoreId]] as const) {
      expect((await findByEmail(email))?.id, email).toBe(id);
      expect(await findIdByEmail(email), email).toBe(id);
      expect(await findSessionAccount(id, email), email).toEqual({ id, role: "EDITOR", sessionVersion: 0 });
      expect(await findAccountJobFunctionByEmail(email), email).toEqual({ jobFunctionId: null });
      expect(await findAccessScopeByEmail(email), email).not.toBeNull();
    }
  });

  it("an address never resolves to the other one's account", async () => {
    expect(await findSessionAccount(dotId, UNDERSCORE)).toBeNull();
    expect(await findSessionAccount(underscoreId, DOT)).toBeNull();
  });

  it("an input with wildcards finds nothing, on every reader", async () => {
    for (const email of ["%", "_%", "%@%", `%${DOMAIN}`, `jean_dupont${DOMAIN.replace("@", "%")}`, `jean._upont${DOMAIN}`, `j%${DOMAIN}`]) {
      expect(await findByEmail(email), email).toBeNull();
      expect(await findIdByEmail(email), email).toBeNull();
      expect(await findAccountJobFunctionByEmail(email), email).toBeNull();
      expect(await findAccessScopeByEmail(email), email).toBeNull();
      expect(await findByUserEmail(email), email).toBeNull();
    }
    expect(await findSessionAccount(dotId, `%${DOMAIN}`)).toBeNull();
  });
});
