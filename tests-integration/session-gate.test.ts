import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { remove, updatePassword, updateProfile } from "@/repository/users";
import { authConfig } from "@/auth.config";

/**
 * lib/auth.ts's own `jwt` callback is the one place the session-liveness
 * check (lib/sessionGate.ts) actually runs — its unit tests
 * (tests/session-gate.test.ts) exercise `keepLiveSessionToken` directly, with
 * `findSessionAccount` mocked. This is the one test that goes through the
 * REAL callback NextAuth() is actually configured with, against a real
 * Postgres, so a wiring mistake in lib/auth.ts itself (wrong spread order,
 * wrong branch) has somewhere to show up that no unit test can reach.
 *
 * `next-auth` itself is mocked (constructing the real `NextAuth()` needs a
 * full request/Auth.js runtime this test has no use for) — but the config
 * OBJECT that `lib/auth.ts` builds and hands to it, including its merged
 * `callbacks.jwt`, is captured unmodified and called directly below.
 */

type SessionToken = { sub?: string; email?: string | null; role?: string; sessionVersion?: number };
type JwtCallback = (params: { token: SessionToken; user?: { role?: string; sessionVersion?: number } }) => Promise<SessionToken | null>;
type CapturedConfig = { callbacks: { jwt: JwtCallback; session: unknown } };

// `vi.hoisted` so `captured` exists already when the `next-auth` mock
// factory below runs — that factory executes while `@/lib/auth` is being
// imported, which Vitest resolves before any of this file's own top-level
// `const`/`let` statements would otherwise have run.
const captured = vi.hoisted(() => ({ config: undefined as CapturedConfig | undefined }));

vi.mock("next-auth", () => ({
  default: vi.fn((config: CapturedConfig) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
}));

vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn() }));

import "@/lib/auth";

function config(): CapturedConfig {
  if (!captured.config) throw new Error("NextAuth() was never called — lib/auth.ts did not build its config");
  return captured.config;
}

function jwt(): JwtCallback {
  return config().callbacks.jwt;
}

const TEST_DOMAIN = "@session-gate-test.local";

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`;
}

async function makeUser(email: string) {
  return prisma.user.create({ data: { email, password: "x", role: "EDITOR" } });
}

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
});

describe("lib/auth.ts's real jwt callback, against a real Postgres", () => {
  it("keeps a token whose account still exists", async () => {
    const email = uniqueEmail("alive");
    const user = await makeUser(email);
    const token: SessionToken = { sub: String(user.id), email, role: "EDITOR" };

    expect(await jwt()({ token })).toEqual(token);
  });

  it("voids the token once its account is deleted (the deleteUser path, repository/users.ts::remove)", async () => {
    const email = uniqueEmail("deleted");
    const user = await makeUser(email);
    const token: SessionToken = { sub: String(user.id), email, role: "EDITOR" };
    expect(await jwt()({ token })).toEqual(token); // alive, before the delete

    await remove(user.id);

    expect(await jwt()({ token })).toBeNull();
  });

  it("voids the OLD token (old id) once its email is recreated under a NEW account, and keeps a fresh token at the NEW id", async () => {
    const email = uniqueEmail("recreated");
    const first = await makeUser(email);
    const oldToken: SessionToken = { sub: String(first.id), email, role: "EDITOR" };
    await remove(first.id);

    const second = await makeUser(email);
    const newToken: SessionToken = { sub: String(second.id), email, role: "EDITOR" };

    // Ids are never reused — the old cookie must not resolve to the new row.
    expect(first.id).not.toBe(second.id);
    expect(await jwt()({ token: oldToken })).toBeNull();
    expect(await jwt()({ token: newToken })).toEqual(newToken);
  });

  describe("the token is compared to the row (lot 3)", () => {
    it("keeps a legacy token (no version) while the row is at 0, and a token stamped with the row's version", async () => {
      const email = uniqueEmail("legacy");
      const user = await makeUser(email);
      const legacy: SessionToken = { sub: String(user.id), email, role: "EDITOR" };
      const stamped: SessionToken = { ...legacy, sessionVersion: 0 };
      expect(await jwt()({ token: legacy })).toEqual(legacy);
      expect(await jwt()({ token: stamped })).toEqual(stamped);
    });

    it("voids the token after a password reset (updatePassword), legacy and stamped alike", async () => {
      const email = uniqueEmail("pwd");
      const user = await makeUser(email);
      const legacy: SessionToken = { sub: String(user.id), email, role: "EDITOR" };
      const stamped: SessionToken = { ...legacy, sessionVersion: 0 };

      await updatePassword(user.id, "new-hash");

      expect(await jwt()({ token: legacy })).toBeNull();
      expect(await jwt()({ token: stamped })).toBeNull();
      // A sign-in after the change is stamped with the row's NEW version and survives.
      const fresh: SessionToken = { ...legacy, sessionVersion: 1 };
      expect(await jwt()({ token: fresh })).toEqual(fresh);
    });

    it("voids the token after a demotion through the account screen's writer (updateProfile)", async () => {
      const email = uniqueEmail("demoted");
      const user = await makeUser(email);
      const token: SessionToken = { sub: String(user.id), email, role: "EDITOR", sessionVersion: 0 };

      await updateProfile(user.id, { name: null, role: "VIEWER", jobFunctionId: null }, null);

      expect(await jwt()({ token })).toBeNull();
    });

    it("voids the token after a role written by something that does NOT bump (a raw update): the role comparison is the net", async () => {
      const email = uniqueEmail("rawrole");
      const user = await makeUser(email);
      const token: SessionToken = { sub: String(user.id), email, role: "EDITOR", sessionVersion: 0 };

      await prisma.user.update({ where: { id: user.id }, data: { role: "VIEWER" } });

      expect(await jwt()({ token })).toBeNull();
    });

    it("keeps the token after a change of name alone (no bump, same role)", async () => {
      const email = uniqueEmail("rename");
      const user = await makeUser(email);
      const token: SessionToken = { sub: String(user.id), email, role: "EDITOR", sessionVersion: 0 };

      await updateProfile(user.id, { name: "Renamed", role: "EDITOR", jobFunctionId: null }, null);

      expect(await jwt()({ token })).toEqual(token);
    });
  });

  it("a sign-in call (user present) carries the role onto the token, WITHOUT any database lookup", async () => {
    // The token arrives WITHOUT a role, as Auth.js hands it to the callback at
    // sign-in: the role is what authConfig's own `jwt` puts there from the
    // authorize() payload. It lives in authConfig because the proxy runs on
    // authConfig alone and reads `req.auth.user.role` for the client-portal
    // boundary — so a lib/auth.ts `jwt` that stops delegating to it would
    // keep every other test in this file green and strip the role off every
    // new login. Asserting the role here is what makes that visible.
    //
    // No account anywhere matches this sub/email — if this reached the
    // database it WOULD come back null, exactly like the "deleted" case
    // above. Getting a token back proves the lookup never ran, by
    // construction, rather than by an assertion on a call count on a mock
    // (there is no mock here — this is the real repository).
    const token: SessionToken = { sub: "999999999", email: "nobody@session-gate-test.local" };
    expect(token.role).toBeUndefined();

    const result = await jwt()({ token, user: { role: "EDITOR", sessionVersion: 4 } });

    expect(result).not.toBeNull();
    expect(result?.role).toBe("EDITOR");
    expect(result?.sessionVersion).toBe(4);
    expect(result?.sub).toBe(token.sub);
    expect(result?.email).toBe(token.email);
  });

  it("keeps authConfig's `session` callback as it is (the role reaches the session through it)", () => {
    // lib/auth.ts overrides `jwt` while spreading authConfig.callbacks. The
    // `session` callback is the other half of the role's journey (token →
    // session.user.role); it must be the very function authConfig defines, so
    // a wiring change that drops or replaces it fails here and not in
    // production, where nothing but the role-gated UI would notice.
    expect(config().callbacks.session).toBe(authConfig.callbacks.session);
  });
});
