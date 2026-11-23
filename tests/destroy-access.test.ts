import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/accessContext", () => ({ getAccessContext: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { getAccessContext } from "@/lib/accessContext";
import { canPermanentlyDeleteClient, canPermanentlyDeleteProject } from "@/lib/destroyAccess";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireEverySectionAccess } from "@/lib/sectionAccess";

/**
 * The trash pages show "Supprimer définitivement" only when the server action
 * would accept it (lot 5b). Each case is checked BOTH ways: the page's boolean
 * and the guards the action calls, on the same access context — so a button can
 * never be offered for a click that is then refused.
 */
const ctx = (hiddenSections: string[], hiddenAreas: string[]) =>
  vi.mocked(getAccessContext).mockResolvedValue({
    email: "x@example.com", role: "EDITOR", hiddenSections: new Set(hiddenSections), hiddenAreas: new Set(hiddenAreas), projectIds: null,
  } as never);

async function actionAcceptsProject(): Promise<boolean> {
  return !(await requireAreaAccess("projects")).error && !(await requireEverySectionAccess()).error;
}
async function actionAcceptsClient(): Promise<boolean> {
  return (
    !(await requireAreaAccess("clients")).error &&
    !(await requireAreaAccess("projects")).error &&
    !(await requireAreaAccess("clients.contacts")).error &&
    !(await requireEverySectionAccess()).error
  );
}

describe("canPermanentlyDelete* matches what the permanent-deletion actions accept", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["nothing hidden", [], [], true, true],
    ["one project section hidden", ["files"], [], false, false],
    ["projects rubrique hidden", [], ["projects"], false, false],
    ["clients.contacts hidden", [], ["clients.contacts"], true, false],
    ["clients rubrique hidden", [], ["clients"], true, false],
  ] as const)("%s", async (_label, sections, areas, project, client) => {
    ctx([...sections], [...areas]);
    expect(await canPermanentlyDeleteProject()).toBe(project);
    expect(await canPermanentlyDeleteClient()).toBe(client);
    expect(await actionAcceptsProject()).toBe(project);
    expect(await actionAcceptsClient()).toBe(client);
  });
});
