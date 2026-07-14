import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/service/auth", () => ({ verifyCredentials: vi.fn() }));

import { authorizeCredentials } from "@/lib/authorizeCredentials";
import { verifyCredentials } from "@/service/auth";
import { clearRateLimit } from "@/lib/rate-limit";

const verifyCredentialsMock = vi.mocked(verifyCredentials);

function requestFromIp(ip: string): Request {
  return new Request("https://example.com", { headers: { "x-forwarded-for": ip } });
}

describe("authorizeCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimit();
  });

  it("returns the user on valid credentials", async () => {
    verifyCredentialsMock.mockResolvedValue({ id: "1", email: "alice@example.com", role: "ADMIN" } as never);
    const user = await authorizeCredentials(
      { email: "alice@example.com", password: "correct" },
      requestFromIp("1.1.1.1")
    );
    expect(user).toEqual({ id: "1", email: "alice@example.com", role: "ADMIN" });
  });

  it("returns null and records a failure on invalid credentials", async () => {
    verifyCredentialsMock.mockResolvedValue(null);
    const user = await authorizeCredentials(
      { email: "alice@example.com", password: "wrong" },
      requestFromIp("1.1.1.1")
    );
    expect(user).toBeNull();
  });

  // The actual regression test for the fix: this simulates an attacker
  // calling the Auth.js /api/auth/callback/credentials endpoint directly
  // (bypassing the custom `login` server action entirely) many times in a
  // row. Enforcement now lives in authorize() itself, so it must still kick
  // in regardless of which caller invokes it.
  it("blocks further attempts for the same email after 5 failures, even with valid credentials on the next try", async () => {
    verifyCredentialsMock.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      await authorizeCredentials({ email: "bob@example.com", password: "wrong" }, requestFromIp("2.2.2.2"));
    }
    verifyCredentialsMock.mockResolvedValue({ id: "2", email: "bob@example.com", role: "VIEWER" } as never);
    const user = await authorizeCredentials(
      { email: "bob@example.com", password: "correct-this-time" },
      requestFromIp("2.2.2.2")
    );
    expect(user).toBeNull();
    // Rate-limited before even reaching verifyCredentials.
    expect(verifyCredentialsMock).toHaveBeenCalledTimes(5);
  });

  it("blocks a spray attack from one IP across many different emails", async () => {
    verifyCredentialsMock.mockResolvedValue(null);
    for (let i = 0; i < 20; i++) {
      await authorizeCredentials({ email: `user${i}@example.com`, password: "wrong" }, requestFromIp("3.3.3.3"));
    }
    verifyCredentialsMock.mockResolvedValue({ id: "3", email: "new-victim@example.com", role: "VIEWER" } as never);
    const user = await authorizeCredentials(
      { email: "new-victim@example.com", password: "correct" },
      requestFromIp("3.3.3.3")
    );
    expect(user).toBeNull();
  });

  it("clears the rate limit for an email on success", async () => {
    verifyCredentialsMock.mockResolvedValue(null);
    for (let i = 0; i < 4; i++) {
      await authorizeCredentials({ email: "carol@example.com", password: "wrong" }, requestFromIp("4.4.4.4"));
    }
    verifyCredentialsMock.mockResolvedValue({ id: "4", email: "carol@example.com", role: "ADMIN" } as never);
    const user = await authorizeCredentials(
      { email: "carol@example.com", password: "correct" },
      requestFromIp("4.4.4.4")
    );
    expect(user).not.toBeNull();
  });
});
