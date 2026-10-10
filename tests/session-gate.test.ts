import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/repository/users", () => ({ findSessionAccount: vi.fn() }));

import { keepLiveSessionToken } from "@/lib/sessionGate";
import { findSessionAccount } from "@/repository/users";

const findSessionAccountMock = vi.mocked(findSessionAccount);

describe("keepLiveSessionToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the token unchanged when the account still exists", async () => {
    findSessionAccountMock.mockResolvedValue({ id: 7 });
    const token = { sub: "7", email: "user@example.com", role: "EDITOR" };

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
