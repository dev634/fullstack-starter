import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sendEmail", () => {
  const originalEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("logs the full message to the console in dev when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to: "alice@example.com", subject: "Reset", html: "<a href='https://x/y?token=secret'>link</a>" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("token=secret"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never logs the message body and throws in production when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { sendEmail } = await import("@/lib/email");

    await expect(
      sendEmail({ to: "alice@example.com", subject: "Reset", html: "<a href='https://x/y?token=secret'>link</a>" })
    ).rejects.toBeTruthy();

    expect(logSpy).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(String(call.join(" "))).not.toContain("secret");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the Resend API when RESEND_API_KEY is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RESEND_API_KEY = "re_test_key";
    fetchSpy.mockResolvedValue({ ok: true } as Response);
    const { sendEmail } = await import("@/lib/email");

    await sendEmail({ to: "alice@example.com", subject: "Reset", html: "<p>hi</p>" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_test_key" }),
      })
    );
    expect(logSpy).not.toHaveBeenCalled();
  });
});
