import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/repository/rateLimit", () => ({
  getRecentAttempts: vi.fn(),
  recordAttempt: vi.fn(),
  clearAttempts: vi.fn(),
}));

import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";
import { getRecentAttempts, recordAttempt, clearAttempts } from "@/repository/rateLimit";

const getRecentAttemptsMock = vi.mocked(getRecentAttempts);
const recordAttemptMock = vi.mocked(recordAttempt);
const clearAttemptsMock = vi.mocked(clearAttempts);
const OPTS = { limit: 3, windowMs: 1000 };

describe("rate-limit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows a fresh key", async () => {
    getRecentAttemptsMock.mockResolvedValue({ count: 0, oldestAt: null });
    expect((await isRateLimited("k", OPTS)).limited).toBe(false);
  });

  it("does not limit below the threshold", async () => {
    getRecentAttemptsMock.mockResolvedValue({ count: 2, oldestAt: new Date() });
    expect((await isRateLimited("k", OPTS)).limited).toBe(false);
  });

  it("blocks once the count reaches the limit, with a retryAfterMs derived from the oldest attempt", async () => {
    const oldestAt = new Date(Date.now() - 400); // 400ms into a 1000ms window
    getRecentAttemptsMock.mockResolvedValue({ count: 3, oldestAt });
    const r = await isRateLimited("k", OPTS);
    expect(r.limited).toBe(true);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(600);
  });

  it("registerFailure delegates to the repository", async () => {
    await registerFailure("k");
    expect(recordAttemptMock).toHaveBeenCalledWith("k");
  });

  it("clearRateLimit delegates to the repository", async () => {
    await clearRateLimit("k");
    expect(clearAttemptsMock).toHaveBeenCalledWith("k");
  });
});
