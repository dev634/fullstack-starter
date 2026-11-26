import { describe, it, expect, vi, beforeEach } from "vitest";

// service/clients.ts::createClient with its two boundaries mocked: the repository (no
// database) and getLocale (no request context). The dictionary and the schema are the real ones.
vi.mock("@/repository/clients", () => ({ create: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { createClient } from "@/service/clients";
import { create } from "@/repository/clients";
import fr from "@/lib/i18n/dictionaries/fr";

const createMock = vi.mocked(create);

const VALID = {
  email: "alice@example.com",
  companyName: "Acme",
  address: "1 St",
  city: "NYC",
  zipCode: "10001",
  country: "US",
  status: "PROSPECT" as const,
};

beforeEach(() => {
  createMock.mockReset();
  // The service logs what it catches; keep the run readable.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("service/clients.ts::createClient — what leaves when the repository refuses", () => {
  it("relays the duplicate-email refusal as it is: { type: 'databaseError', i18n: 'duplicateClientEmail' }", async () => {
    const duplicate = {
      type: "databaseError",
      message: "A client with this email already exists. Please use a different email.",
      i18n: "duplicateClientEmail",
    };
    createMock.mockRejectedValue(duplicate);
    // The very same object: not rewrapped into the generic server error, not stripped of its code.
    await expect(createClient(VALID)).rejects.toBe(duplicate);
    await expect(createClient(VALID)).rejects.toMatchObject({ type: "databaseError", i18n: "duplicateClientEmail" });
  });

  it("turns any other repository failure into the generic localized server error (no internals relayed)", async () => {
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating client." });
    await expect(createClient(VALID)).rejects.toEqual({ type: "error", message: fr.errors.serverError });
  });

  it("answers the created id on success", async () => {
    createMock.mockResolvedValue({ id: 42 });
    await expect(createClient(VALID)).resolves.toMatchObject({ type: "success", id: 42 });
  });

  it("refuses an invalid payload with a zodError, without calling the repository", async () => {
    await expect(createClient({ ...VALID, email: "not-an-email" })).rejects.toMatchObject({ type: "zodError" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
