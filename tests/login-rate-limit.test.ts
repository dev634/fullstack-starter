import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: vi.fn(),
  registerFailure: vi.fn(),
  clearRateLimit: vi.fn(),
}));

import { isLoginRateLimited, registerLoginFailure, clearLoginRateLimit } from "@/lib/loginRateLimit";
import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";

const isRateLimitedMock = vi.mocked(isRateLimited);
const registerFailureMock = vi.mocked(registerFailure);
const clearRateLimitMock = vi.mocked(clearRateLimit);
const NOT_LIMITED = { limited: false, retryAfterMs: 0 };

describe("loginRateLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows a fresh email/IP pair", async () => {
    isRateLimitedMock.mockResolvedValue(NOT_LIMITED);
    expect((await isLoginRateLimited("alice@example.com", "1.2.3.4")).limited).toBe(false);
  });

  it("is limited when the email check reports limited", async () => {
    isRateLimitedMock.mockImplementation(async (key) =>
      key.startsWith("login:") ? { limited: true, retryAfterMs: 1000 } : NOT_LIMITED
    );
    expect((await isLoginRateLimited("alice@example.com", "9.9.9.9")).limited).toBe(true);
  });

  it("is limited when the IP check reports limited (spray protection)", async () => {
    isRateLimitedMock.mockImplementation(async (key) =>
      key.startsWith("login-ip:") ? { limited: true, retryAfterMs: 500 } : NOT_LIMITED
    );
    expect((await isLoginRateLimited("someone-else@example.com", "1.2.3.4")).limited).toBe(true);
  });

  it("registerLoginFailure records both the email and IP keys", async () => {
    await registerLoginFailure("Alice@Example.com", "1.2.3.4");
    expect(registerFailureMock).toHaveBeenCalledWith("login:alice@example.com");
    expect(registerFailureMock).toHaveBeenCalledWith("login-ip:1.2.3.4");
  });

  it("clearLoginRateLimit only clears the email key, not any IP counter", async () => {
    await clearLoginRateLimit("Alice@Example.com");
    expect(clearRateLimitMock).toHaveBeenCalledWith("login:alice@example.com");
    expect(clearRateLimitMock).toHaveBeenCalledTimes(1);
  });
});
