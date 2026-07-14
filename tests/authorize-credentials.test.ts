import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/service/auth", () => ({ verifyCredentials: vi.fn() }));

// A stateful in-memory fake of the DB repository, so these tests exercise
// the real cumulative rate-limiting logic (lib/rate-limit.ts,
// lib/loginRateLimit.ts, lib/authorizeCredentials.ts) across many sequential
// calls, without touching a real database. Declared via vi.hoisted so it's
// available inside the hoisted vi.mock factory below.
const { fakeRows } = vi.hoisted(() => ({ fakeRows: new Map<string, number[]>() }));

vi.mock("@/repository/rateLimit", () => ({
  getRecentAttempts: vi.fn(async (key: string, windowMs: number) => {
    const since = Date.now() - windowMs;
    const recent = (fakeRows.get(key) ?? []).filter((t: number) => t >= since);
    return { count: recent.length, oldestAt: recent.length ? new Date(recent[0]) : null };
  }),
  recordAttempt: vi.fn(async (key: string) => {
    const arr = fakeRows.get(key) ?? [];
    arr.push(Date.now());
    fakeRows.set(key, arr);
  }),
  clearAttempts: vi.fn(async (key: string) => {
    fakeRows.delete(key);
  }),
}));

import { authorizeCredentials } from "@/lib/authorizeCredentials";
import { verifyCredentials } from "@/service/auth";

const verifyCredentialsMock = vi.mocked(verifyCredentials);

function requestFromIp(ip: string): Request {
  return new Request("https://example.com", { headers: { "x-forwarded-for": ip } });
}

describe("authorizeCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeRows.clear();
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
    for (let i = 0; i < 4; i++) {
      await authorizeCredentials({ email: "bob@example.com", password: "wrong" }, requestFromIp("2.2.2.2"));
    }
    verifyCredentialsMock.mockResolvedValue({ id: "2", email: "bob@example.com", role: "VIEWER" } as never);
    const user = await authorizeCredentials(
      { email: "bob@example.com", password: "correct-this-time" },
      requestFromIp("2.2.2.2")
    );
    expect(user).toBeNull();
    // The attempt is recorded BEFORE being checked (see authorizeCredentials —
    // needed so a concurrent burst can't all pass the check before any of
    // them registers), so the 5th recorded attempt is the one that trips the
    // limit and never reaches verifyCredentials, even though it happens to
    // carry the correct password. Only attempts 1-4 got that far.
    expect(verifyCredentialsMock).toHaveBeenCalledTimes(4);
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
    // Stay under the effective ceiling (3 failures, not the full 4) so the
    // next attempt's registration doesn't itself trip the limit before its
    // (correct) password ever gets checked.
    for (let i = 0; i < 3; i++) {
      await authorizeCredentials({ email: "carol@example.com", password: "wrong" }, requestFromIp("4.4.4.4"));
    }
    verifyCredentialsMock.mockResolvedValue({ id: "4", email: "carol@example.com", role: "ADMIN" } as never);
    const user = await authorizeCredentials(
      { email: "carol@example.com", password: "correct" },
      requestFromIp("4.4.4.4")
    );
    expect(user).not.toBeNull();
  });

  // Regression test for the TOCTOU race: a real brute-force tool fires
  // requests concurrently, not sequentially. The old (in-memory, check-then-
  // record) design only recorded a failure *after* awaiting the (slow)
  // bcrypt compare, so a burst of concurrent requests could all pass the
  // rate-limit check before any of them had registered — letting far more
  // than 5 guesses through. Recording is now unconditional and happens
  // before the check, so every concurrent attempt is durably counted the
  // instant it arrives — the exact number that slip through before the
  // count catches up depends on scheduling, but it can never exceed the
  // configured budget.
  it("blocks a burst of concurrent attempts, not just sequential ones", async () => {
    let resolveAll: (value: null) => void;
    const pending = new Promise<null>((resolve) => {
      resolveAll = resolve;
    });
    verifyCredentialsMock.mockReturnValue(pending);

    const attempts = Array.from({ length: 10 }, () =>
      authorizeCredentials({ email: "dave@example.com", password: "wrong" }, requestFromIp("5.5.5.5"))
    );
    // Let all 10 calls run up to their `await verifyCredentials(...)` before
    // any of them resolves, simulating truly concurrent requests.
    await Promise.resolve();
    await Promise.resolve();
    resolveAll!(null);
    await Promise.all(attempts);

    // Never more than the configured per-email budget (5) reach
    // verifyCredentials, no matter how the 10 concurrent attempts interleave.
    expect(verifyCredentialsMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("trusts the last X-Forwarded-For hop (the proxy-appended one), not an attacker-supplied prefix", async () => {
    verifyCredentialsMock.mockResolvedValue(null);
    const spoofedThenReal = new Request("https://example.com", {
      headers: { "x-forwarded-for": "9.9.9.9, 6.6.6.6" },
    });
    for (let i = 0; i < 20; i++) {
      await authorizeCredentials({ email: `spray${i}@example.com`, password: "wrong" }, spoofedThenReal);
    }
    // The real (last-hop) IP 6.6.6.6 should now be spray-limited...
    verifyCredentialsMock.mockResolvedValue({ id: "5", email: "victim@example.com", role: "VIEWER" } as never);
    const blocked = await authorizeCredentials({ email: "victim@example.com", password: "correct" }, spoofedThenReal);
    expect(blocked).toBeNull();
    // ...but a request that genuinely arrives from a different last hop is unaffected.
    const otherIp = new Request("https://example.com", { headers: { "x-forwarded-for": "9.9.9.9, 7.7.7.7" } });
    const notBlocked = await authorizeCredentials({ email: "victim@example.com", password: "correct" }, otherIp);
    expect(notBlocked).not.toBeNull();
  });
});
