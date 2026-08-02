import { describe, it, expect } from "vitest";
import { hashResetToken } from "@/lib/resetToken";

describe("hashResetToken", () => {
  it("is a 64-char hex SHA-256, deterministic for the same input", () => {
    const a = hashResetToken("abc123");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken("abc123")).toBe(a);
  });

  it("differs for different tokens and never returns the input verbatim", () => {
    const token = "a".repeat(64);
    const hash = hashResetToken(token);
    expect(hash).not.toBe(token);
    expect(hashResetToken("b".repeat(64))).not.toBe(hash);
  });
});
