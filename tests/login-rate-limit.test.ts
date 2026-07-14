import { describe, it, expect, beforeEach } from "vitest";
import { isLoginRateLimited, registerLoginFailure, clearLoginRateLimit } from "@/lib/loginRateLimit";
import { clearRateLimit } from "@/lib/rate-limit";

describe("loginRateLimit", () => {
  beforeEach(() => clearRateLimit());

  it("allows a fresh email/IP pair", () => {
    expect(isLoginRateLimited("alice@example.com", "1.2.3.4").limited).toBe(false);
  });

  it("blocks the same email after enough failures, even from a different IP", () => {
    for (let i = 0; i < 5; i++) registerLoginFailure("alice@example.com", "1.2.3.4");
    expect(isLoginRateLimited("alice@example.com", "9.9.9.9").limited).toBe(true);
  });

  it("blocks the same IP after enough failures across different emails (spray)", () => {
    for (let i = 0; i < 20; i++) registerLoginFailure(`user${i}@example.com`, "1.2.3.4");
    expect(isLoginRateLimited("someone-else@example.com", "1.2.3.4").limited).toBe(true);
  });

  it("clearing an email's limit does not affect its IP counter", () => {
    for (let i = 0; i < 5; i++) registerLoginFailure("alice@example.com", "1.2.3.4");
    clearLoginRateLimit("alice@example.com");
    expect(isLoginRateLimited("alice@example.com", "1.2.3.4").limited).toBe(false);
  });
});
