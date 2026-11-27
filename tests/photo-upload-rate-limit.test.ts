import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The REAL sliding-window logic (lib/rate-limit.ts) runs on top of an in-memory
// stand-in for the Postgres table, so the window really slides with the clock.
const attempts = new Map<string, number[]>();
vi.mock("@/repository/rateLimit", () => ({
  getRecentAttempts: vi.fn(async (key: string, windowMs: number) => {
    const since = Date.now() - windowMs;
    const recent = (attempts.get(key) ?? []).filter((at) => at >= since).sort((a, b) => a - b);
    return { count: recent.length, oldestAt: recent.length ? new Date(recent[0]) : null };
  }),
  recordAttempt: vi.fn(async (key: string) => {
    attempts.set(key, [...(attempts.get(key) ?? []), Date.now()]);
  }),
  clearAttempts: vi.fn(),
}));

import { PHOTO_UPLOAD_LIMIT, reservePhotoUpload } from "@/lib/photoUploadRateLimit";
import { getErrorMessage } from "@/lib/helpers";
import { getDictionary } from "@/lib/i18n/dictionaries";

async function refusalOf(email: string): Promise<unknown> {
  return reservePhotoUpload(email).then(
    () => null,
    (e: unknown) => e
  );
}

describe("reservePhotoUpload — 30 photos per 15 minutes per account", () => {
  beforeEach(() => {
    attempts.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("publishes the budget it enforces", () => {
    expect(PHOTO_UPLOAD_LIMIT).toEqual({ limit: 30, windowMs: 15 * 60 * 1000 });
  });

  it("lets 30 photos through and refuses the 31st, with the delay", async () => {
    for (let i = 0; i < 30; i++) {
      expect(await refusalOf("admin@x.com"), `photo ${i + 1}`).toBeNull();
      vi.advanceTimersByTime(1000); // one a second: the 31st lands 30 s after the first
    }
    const refusal = await refusalOf("admin@x.com");
    expect(refusal).toMatchObject({ type: "error", i18n: "photoRateLimited" });
    // 15 min window, oldest photo sent 30 s ago: 14.5 min left, rounded up to 15.
    expect(refusal).toMatchObject({ i18nParams: { minutes: 15 } });
  });

  it("gives the localized message with the delay, FR and EN", async () => {
    for (let i = 0; i < 30; i++) await reservePhotoUpload("admin@x.com");
    const refusal = await refusalOf("admin@x.com");
    expect(getErrorMessage(refusal, "fallback", getDictionary("fr"))).toBe(
      "Trop de photos envoyées en peu de temps. Réessaie dans 15 min."
    );
    expect(getErrorMessage(refusal, "fallback", getDictionary("en"))).toBe(
      "Too many photos sent in a short time. Try again in 15 min."
    );
  });

  it("does not count a refused attempt (a blocked caller who keeps retrying must still be freed by the window)", async () => {
    for (let i = 0; i < 30; i++) await reservePhotoUpload("admin@x.com");
    for (let i = 0; i < 10; i++) expect(await refusalOf("admin@x.com")).not.toBeNull();
    expect(attempts.get("photo-upload:admin@x.com")).toHaveLength(30);
  });

  it("frees the window: after 15 minutes the account can send again", async () => {
    for (let i = 0; i < 30; i++) await reservePhotoUpload("admin@x.com");
    expect(await refusalOf("admin@x.com")).not.toBeNull();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await refusalOf("admin@x.com")).toBeNull();
  });

  it("frees one place at a time as the oldest photos leave the window", async () => {
    await reservePhotoUpload("admin@x.com"); // t = 0
    vi.advanceTimersByTime(60 * 1000);
    for (let i = 0; i < 29; i++) await reservePhotoUpload("admin@x.com"); // t = 1 min
    expect(await refusalOf("admin@x.com")).toMatchObject({ i18nParams: { minutes: 14 } });
    vi.advanceTimersByTime(14 * 60 * 1000 + 1); // the t = 0 photo has left, the other 29 have not
    expect(await refusalOf("admin@x.com")).toBeNull();
    expect(await refusalOf("admin@x.com")).not.toBeNull();
  });

  it("is per account: one account's loop does not spend another's budget", async () => {
    for (let i = 0; i < 30; i++) await reservePhotoUpload("loop@x.com");
    expect(await refusalOf("loop@x.com")).not.toBeNull();
    expect(await refusalOf("other@x.com")).toBeNull();
  });
});
