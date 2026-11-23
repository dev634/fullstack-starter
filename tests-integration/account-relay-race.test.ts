import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * The relay rule is checked and then written. Done in two round trips (read the
 * function's hiddenAreas / count its holders, then write), a parallel request
 * slips between the two and reopens the relay — and addUser even hashes the
 * password (bcrypt, tens of ms) between them. These tests run the REAL actions
 * (real session context, real repository, real Postgres, real bcrypt) in
 * Promise.all, many times, and assert the invariant on what ended up in the
 * database: no account holds a function that no longer covers the actor.
 *
 * Only the session (`auth`), Next's cache and the locale are stubbed — nothing
 * on the path under test.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { auth } from "@/lib/auth";
import { addUser, updateUser } from "@/actions/users/users";
import { saveFunctionConfig, deleteJobFunction } from "@/actions/jobFunctions/jobFunctions";

const TAG = `race-${Date.now()}`;
const DOMAIN = `@${TAG}.local`;
const ROUNDS = 20;
const initial = { type: null, message: "" } as const;
const ACTOR_HIDES = ["clients.contacts"];
const covers = (hidden: string[]) => hidden.includes("clients.contacts") || hidden.includes("clients");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let actorEmail = "";
let ownFunctionId = 0;
let seq = 0;
const nextName = (kind: string) => `${TAG}-${kind}-${seq++}`;

async function makeFunction(hiddenAreas: string[]) {
  return prisma.jobFunction.create({ data: { name: nextName("fn"), hiddenAreas } });
}

beforeAll(async () => {
  // The restricted ADMIN: their own function hides clients.contacts.
  const own = await makeFunction(ACTOR_HIDES);
  ownFunctionId = own.id;
  actorEmail = `actor${DOMAIN}`;
  await prisma.user.create({ data: { email: actorEmail, name: "Actor", password: "x", role: "ADMIN", jobFunctionId: own.id } });
  vi.mocked(auth).mockResolvedValue({ user: { role: "ADMIN", email: actorEmail } } as never);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.jobFunction.deleteMany({ where: { name: { startsWith: TAG } } });
});

describe("relay rule under concurrency (real actions, real database)", () => {
  it("addUser(F) || saveFunctionConfig(F, hides nothing): no holder of a function that stopped covering the actor", async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < ROUNDS; i++) {
      const fn = await makeFunction(ACTOR_HIDES); // covers the actor, nobody holds it
      const email = `holder${i}${DOMAIN}`;
      const [added, saved] = await Promise.all([
        addUser(initial, form({ email, name: "H", role: "EDITOR", password: "password123", jobFunctionId: String(fn.id) })),
        saveFunctionConfig(fn.id, { hiddenSections: [], projectScope: "ALL", hiddenAreas: [] }),
      ]);
      outcomes.add(`${added.type}/${(saved as { type: string }).type}`);

      const after = await prisma.jobFunction.findUniqueOrThrow({ where: { id: fn.id }, select: { hiddenAreas: true } });
      const holders = await prisma.user.count({ where: { jobFunctionId: fn.id } });
      // The invariant: a held function still covers the actor. Whichever won, exactly one did.
      expect(holders === 0 || covers(after.hiddenAreas), `round ${i}: ${holders} holder(s) on a function hiding [${after.hiddenAreas}]`).toBe(true);
      expect(added.type === "success" || (saved as { type: string }).type === "success", `round ${i}`).toBe(true);
    }
    // Both orders are legitimate; what must never appear is a holder on a loosened function (asserted above).
    expect([...outcomes].every((o) => o === "success/error" || o === "error/success")).toBe(true);
  }, 120_000);

  it("deleteJobFunction(F) || updateUser(U -> F): the account never ends with no function", async () => {
    const home = await makeFunction(ACTOR_HIDES);
    const user = await prisma.user.create({ data: { email: `mover${DOMAIN}`, name: "M", password: "x", role: "EDITOR", jobFunctionId: home.id } });
    for (let i = 0; i < ROUNDS; i++) {
      await prisma.user.update({ where: { id: user.id }, data: { jobFunctionId: home.id } });
      const fn = await makeFunction(ACTOR_HIDES);
      await Promise.all([
        updateUser(initial, form({ id: String(user.id), name: "M", role: "EDITOR", jobFunctionId: String(fn.id) })),
        deleteJobFunction(fn.id),
      ]);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { jobFunctionId: true } });
      // SetNull would leave a relay (no function): the account is on `home` or on `fn`, never null.
      expect(after.jobFunctionId, `round ${i}`).not.toBeNull();
      const stillThere = await prisma.jobFunction.findUnique({ where: { id: fn.id } });
      if (after.jobFunctionId === fn.id) expect(stillThere, `round ${i}`).not.toBeNull();
    }
  }, 120_000);

  it("the actor's own function stays untouched (sanity: the fixture is a restricted ADMIN)", async () => {
    const own = await prisma.jobFunction.findUniqueOrThrow({ where: { id: ownFunctionId }, select: { hiddenAreas: true } });
    expect(own.hiddenAreas).toEqual(ACTOR_HIDES);
  });
});
