import { describe, it, expect, beforeEach } from "vitest";
import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";

const OPTS = { limit: 3, windowMs: 1000 };

describe("rate-limit", () => {
  beforeEach(() => clearRateLimit());

  it("allows a fresh key", () => {
    expect(isRateLimited("k", OPTS, 0).limited).toBe(false);
  });

  it("blocks once failures reach the limit", () => {
    registerFailure("k", OPTS, 0);
    registerFailure("k", OPTS, 0);
    expect(isRateLimited("k", OPTS, 0).limited).toBe(false);
    registerFailure("k", OPTS, 0); // 3rd failure hits the limit
    const r = isRateLimited("k", OPTS, 0);
    expect(r.limited).toBe(true);
    expect(r.retryAfterMs).toBe(1000);
  });

  it("resets after the window elapses", () => {
    for (let i = 0; i < 3; i++) registerFailure("k", OPTS, 0);
    expect(isRateLimited("k", OPTS, 500).limited).toBe(true);
    expect(isRateLimited("k", OPTS, 1000).limited).toBe(false);
  });

  it("isolates keys and clears them", () => {
    for (let i = 0; i < 3; i++) registerFailure("a", OPTS, 0);
    expect(isRateLimited("a", OPTS, 0).limited).toBe(true);
    expect(isRateLimited("b", OPTS, 0).limited).toBe(false);
    clearRateLimit("a");
    expect(isRateLimited("a", OPTS, 0).limited).toBe(false);
  });
});
