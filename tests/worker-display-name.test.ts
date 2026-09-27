import { describe, it, expect } from "vitest";
import { workerDisplayName } from "@/lib/workerDisplayName";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";

describe("workerDisplayName", () => {
  it("returns the User's own name when set", () => {
    expect(workerDisplayName({ id: 4, name: "Paul Dupont" }, fr)).toBe("Paul Dupont");
  });

  // The degenerate line: a User row with no name set. Never the email —
  // repository/projectWorkers.ts never sends it — and never an empty string
  // silently rendered.
  it("falls back to a neutral, non-identifying label when name is null", () => {
    expect(workerDisplayName({ id: 4, name: null }, fr)).toBe("Utilisateur #4");
    expect(workerDisplayName({ id: 4, name: null }, en)).toBe("User #4");
  });
});
