import { describe, it, expect, vi } from "vitest";

vi.mock("@/forms/LoginForm", () => ({ default: () => null }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import LoginPage from "@/app/login/page";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";

/**
 * actions/users/users.ts::updateUser signs a caller out of a credentials
 * change of their OWN account with `/login?raison=identifiants-modifies`. The
 * login page explains it for that value and for no other: an unknown, repeated
 * or empty value renders nothing extra (the query string is attacker-writable).
 */
const render = async (raison?: string | string[]) => JSON.stringify(await LoginPage({ searchParams: Promise.resolve({ raison }) }));

describe("the login page's `raison` message", () => {
  it("shows the credentials-changed message for identifiants-modifies", async () => {
    expect(await render("identifiants-modifies")).toContain(fr.auth.credentialsChanged);
  });

  it.each([[undefined], ["autre"], [""], ["IDENTIFIANTS-MODIFIES"], [["identifiants-modifies", "x"]]])("shows nothing for %j", async (raison) => {
    expect(await render(raison)).not.toContain(fr.auth.credentialsChanged);
  });

  it("has an English text, different from the French one", () => {
    expect(en.auth.credentialsChanged).toBeTruthy();
    expect(en.auth.credentialsChanged).not.toBe(fr.auth.credentialsChanged);
  });
});
