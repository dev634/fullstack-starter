import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/repository/users", () => ({ findSessionAccount: vi.fn() }));

import { keepLiveSessionToken } from "@/lib/sessionGate";
import { findSessionAccount } from "@/repository/users";

const findSessionAccountMock = vi.mocked(findSessionAccount);

describe("keepLiveSessionToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the token unchanged when the account still exists", async () => {
    findSessionAccountMock.mockResolvedValue({ id: 7, role: "EDITOR", sessionVersion: 0 });
    const token = { sub: "7", email: "user@example.com", role: "EDITOR", sessionVersion: 0 };

    const result = await keepLiveSessionToken(token);

    expect(result).toBe(token);
    expect(findSessionAccountMock).toHaveBeenCalledWith(7, "user@example.com");
  });

  it("returns null when the account row is absent (deleted)", async () => {
    findSessionAccountMock.mockResolvedValue(null);
    const token = { sub: "7", email: "user@example.com" };

    const result = await keepLiveSessionToken(token);

    expect(result).toBeNull();
  });

  describe("the token is compared to the row (sessionVersion, role)", () => {
    const account = (sessionVersion: number, role: "EDITOR" | "ADMIN" = "EDITOR") => ({ id: 7, role, sessionVersion });
    const base = { sub: "7", email: "user@example.com", role: "EDITOR" as const };

    it("an ABSENT token version reads as 0: a cookie issued before the column existed is kept while the row is at 0", async () => {
      findSessionAccountMock.mockResolvedValue(account(0));
      const token = { ...base };
      expect(await keepLiveSessionToken(token)).toBe(token);
    });

    it("absent token version + row at 1 -> null (the password changed after that cookie was issued)", async () => {
      findSessionAccountMock.mockResolvedValue(account(1));
      expect(await keepLiveSessionToken({ ...base })).toBeNull();
    });

    it("token 0 + row at 1 -> null", async () => {
      findSessionAccountMock.mockResolvedValue(account(1));
      expect(await keepLiveSessionToken({ ...base, sessionVersion: 0 })).toBeNull();
    });

    it("token 1 + row at 1 -> kept", async () => {
      findSessionAccountMock.mockResolvedValue(account(1));
      const token = { ...base, sessionVersion: 1 };
      expect(await keepLiveSessionToken(token)).toBe(token);
    });

    it("token 1 + row at 0 -> null (a version ahead of the row is not trusted either)", async () => {
      findSessionAccountMock.mockResolvedValue(account(0));
      expect(await keepLiveSessionToken({ ...base, sessionVersion: 1 })).toBeNull();
    });

    it("a different role -> null, version equal (the demotion case: a role written by anything that does not bump)", async () => {
      findSessionAccountMock.mockResolvedValue(account(0, "ADMIN"));
      expect(await keepLiveSessionToken({ ...base, role: "EDITOR" })).toBeNull();
    });

    it("a token without a role against a row that has one -> null", async () => {
      findSessionAccountMock.mockResolvedValue(account(0));
      expect(await keepLiveSessionToken({ sub: "7", email: "user@example.com" })).toBeNull();
    });

    it.each([
      ["a string", "1"],
      ["negative", -1],
      ["a decimal", 1.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["null", null],
      ["an object", { increment: 1 }],
    ])("a PRESENT but malformed token version (%s: %j) is refused, even when the row is at 0 — never normalized to 0", async (_label, sessionVersion) => {
      findSessionAccountMock.mockResolvedValue(account(0));
      expect(await keepLiveSessionToken({ ...base, sessionVersion })).toBeNull();
    });
  });

  // The contract lib/sessionGate.ts documents for a database outage: the
  // lookup's failure goes through, so a session is never kept on an answer
  // nobody gave. (What Auth.js then does with the throw — `auth()` resolves to
  // null, /login, a JWTSessionError line — was checked against the real
  // NextAuth(), not here: that needs a Next request context.)
  it("lets the lookup's failure through instead of keeping the token", async () => {
    findSessionAccountMock.mockRejectedValue({ type: "repositoryError", message: "Database Error fetching session account." });

    await expect(keepLiveSessionToken({ sub: "7", email: "user@example.com" })).rejects.toMatchObject({ type: "repositoryError" });
  });

  // A value this gate cannot parse must void the session outright, never
  // fall back to treating it as valid — see each case below.
  describe("an unparsable sub refuses without a database round trip", () => {
    it.each([
      ["absent", undefined],
      ["non-numeric", "abc"],
      ["zero", "0"],
      ["a decimal", "1.5"],
      ["negative", "-3"],
      ["empty string", ""],
    ])("sub is %s (%j)", async (_label, sub) => {
      const result = await keepLiveSessionToken({ sub, email: "user@example.com" });
      expect(result).toBeNull();
      expect(findSessionAccountMock).not.toHaveBeenCalled();
    });
  });

  describe("an absent/empty email refuses without a database round trip", () => {
    it.each([
      ["absent", undefined],
      ["null", null],
      ["empty string", ""],
    ])("email is %s (%j)", async (_label, email) => {
      const result = await keepLiveSessionToken({ sub: "7", email });
      expect(result).toBeNull();
      expect(findSessionAccountMock).not.toHaveBeenCalled();
    });
  });
});
