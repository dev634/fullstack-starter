import { describe, it, expect } from "vitest";
import type { JWT } from "@auth/core/jwt";
import { authConfig } from "@/auth.config";

/**
 * auth.config.ts's `jwt` stamps the role AND the sessionVersion on the token at
 * sign-in — and only then. lib/sessionGate.ts compares both to the row on every
 * later read: a refresh that adopted the row's current version would make the
 * comparison vacuous. Edge-safe by construction (no database here).
 */

const SIGN_IN_USER = { id: "7", email: "user@example.com", role: "EDITOR" as const, sessionVersion: 3 };

/**
 * A refresh pass: Auth.js calls `jwt` WITHOUT `user`, but types the parameter
 * as if it were always there (a hole in its types, not in the behaviour under
 * test). Reflect.apply reaches the real runtime call without lying to the type
 * of the sign-in case above.
 */
async function refreshPass(token: JWT): Promise<JWT> {
  return Reflect.apply(authConfig.callbacks.jwt, undefined, [{ token }]);
}

describe("authConfig.callbacks.jwt", () => {
  it("stamps role and sessionVersion on the token at sign-in", async () => {
    const token: JWT = { sub: "7", email: "user@example.com" };
    const result = await authConfig.callbacks.jwt({ token, user: SIGN_IN_USER, account: null, trigger: "signIn" });
    expect(result.role).toBe("EDITOR");
    expect(result.sessionVersion).toBe(3);
  });

  it("stamps version 0 too (a falsy version is a version, not an absence)", async () => {
    const result = await authConfig.callbacks.jwt({
      token: { sub: "7" },
      user: { ...SIGN_IN_USER, sessionVersion: 0 },
      account: null,
      trigger: "signIn",
    });
    expect(result.sessionVersion).toBe(0);
  });

  it("never rewrites them on a later pass (no user): the token keeps the version it was issued with", async () => {
    const token: JWT = { sub: "7", email: "user@example.com", role: "EDITOR", sessionVersion: 3 };
    const result = await refreshPass(token);
    expect(result.role).toBe("EDITOR");
    expect(result.sessionVersion).toBe(3);
  });

  it("does not invent a version on a pass without user for a legacy token (absent stays absent)", async () => {
    const result = await refreshPass({ sub: "7", role: "EDITOR" });
    expect(result.sessionVersion).toBeUndefined();
  });
});
