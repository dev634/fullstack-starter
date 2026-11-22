import { describe, it, expect } from "vitest";
import { canRemoveContact } from "@/lib/contactPolicy";

describe("canRemoveContact", () => {
  it.each([
    ["unrestricted caller, links anywhere", [1, 2, 3], null, true],
    ["unrestricted caller, no link", [], null, true],
    ["restricted, no link at all", [], [10], true],
    ["restricted, every link inside the scope", [10, 11], [10, 11, 12], true],
    ["restricted, one link outside the scope", [10, 99], [10, 11], false],
    ["restricted, all links outside", [99], [10], false],
    ["empty scope, a link", [10], [], false],
    ["empty scope, no link", [], [], true],
  ] as const)("%s", (_label, linked, scope, expected) => {
    // The scope is passed the way AccessContext carries it (a Set, or null for
    // "unrestricted") — the one convention, no array conversion at the caller.
    expect(canRemoveContact(linked, scope === null ? null : new Set(scope))).toBe(expected);
  });
});
