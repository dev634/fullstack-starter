import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/repository/users", () => ({
  findByEmail: vi.fn(),
  createResetToken: vi.fn(),
  findValidResetToken: vi.fn(),
  markResetTokenUsed: vi.fn(),
  updatePassword: vi.fn(),
}));

// Stateful in-memory fake of the DB repository so the rate-limit tests below
// (which rely on cumulative counts across several sequential calls) exercise
// the real lib/rate-limit.ts logic without touching a real database.
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

import { requestPasswordReset, resetPassword } from "@/actions/auth/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  findByEmail,
  createResetToken,
  findValidResetToken,
  markResetTokenUsed,
  updatePassword,
} from "@/repository/users";

const sendEmailMock = vi.mocked(sendPasswordResetEmail);
const findByEmailMock = vi.mocked(findByEmail);
const createResetTokenMock = vi.mocked(createResetToken);
const findValidResetTokenMock = vi.mocked(findValidResetToken);
const markResetTokenUsedMock = vi.mocked(markResetTokenUsed);
const updatePasswordMock = vi.mocked(updatePassword);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeRows.clear();
  });

  it("rejects an invalid email with a validation error", async () => {
    const res = await requestPasswordReset(initial, formOf({ email: "not-an-email" }));
    expect(res.type).toBe("zodError");
    expect(findByEmailMock).not.toHaveBeenCalled();
  });

  it("sends a reset email and returns a generic message when the account exists", async () => {
    findByEmailMock.mockResolvedValue({ id: 1, email: "alice@example.com" } as never);
    const res = await requestPasswordReset(initial, formOf({ email: "alice@example.com" }));
    expect(createResetTokenMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1]).toMatch(/\/reset-password\?token=.+/);
    expect(res.type).toBe("success");
    expect(res.message).toMatch(/si un compte existe/i);
  });

  it("returns the same generic message when the account doesn't exist (no enumeration)", async () => {
    findByEmailMock.mockResolvedValue(null);
    const res = await requestPasswordReset(initial, formOf({ email: "nobody@example.com" }));
    expect(createResetTokenMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.type).toBe("success");
    expect(res.message).toMatch(/si un compte existe/i);
  });

  it("stops sending new emails past the rate limit for the same address", async () => {
    findByEmailMock.mockResolvedValue({ id: 1, email: "alice@example.com" } as never);
    for (let i = 0; i < 3; i++) {
      await requestPasswordReset(initial, formOf({ email: "alice@example.com" }));
    }
    const res = await requestPasswordReset(initial, formOf({ email: "alice@example.com" }));
    expect(sendEmailMock).toHaveBeenCalledTimes(3); // the 4th call was throttled
    expect(res.type).toBe("success"); // still generic — doesn't leak the throttling
  });
});

describe("resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeRows.clear();
  });

  it("rejects a weak password", async () => {
    const res = await resetPassword(
      initial,
      formOf({ token: "abc", password: "short", confirmPassword: "short" })
    );
    expect(res.type).toBe("zodError");
    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    const res = await resetPassword(
      initial,
      formOf({ token: "abc", password: "longenough1", confirmPassword: "different1" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.confirmPassword).toBeTruthy();
    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired token", async () => {
    findValidResetTokenMock.mockResolvedValue(null);
    const res = await resetPassword(
      initial,
      formOf({ token: "bad-token", password: "longenough1", confirmPassword: "longenough1" })
    );
    expect(res.type).toBe("error");
    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("updates the password and marks the token used for a valid token", async () => {
    findValidResetTokenMock.mockResolvedValue({ id: 5, userId: 1 } as never);
    const res = await resetPassword(
      initial,
      formOf({ token: "good-token", password: "longenough1", confirmPassword: "longenough1" })
    );
    expect(updatePasswordMock).toHaveBeenCalledWith(1, expect.any(String));
    expect(markResetTokenUsedMock).toHaveBeenCalledWith(5);
    expect(res.type).toBe("success");
  });
});
