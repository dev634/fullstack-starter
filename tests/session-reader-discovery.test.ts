import { describe, it, expect } from "vitest";
import ts from "typescript";
import {
  authImportFormViolationsIn,
  designatesAuthModule,
  sessionDomain,
  sessionReaderNamesIn,
  sessionReadsBeyondRoleIn,
} from "./helpers/sessionReaderScan";

/**
 * Structural guarantee about HOW session readers are found, and about the one
 * place they are not individually probed (app/). The per-reader refusal
 * probes live in tests/session-reader-refusal.test.ts; this file is what
 * makes "every reader is in that table" a fact instead of a hope.
 *
 * Three things, each proven by a planted source (the last describe) and not
 * assumed:
 *
 *   1. NOTHING REACHES lib/auth BY A FORM THE DISCOVERY CANNOT FOLLOW. The
 *      session is read through `auth` from lib/auth.ts, so a reader is found
 *      by that name — and a name can be dodged: `import * as`, a relative
 *      path to the same file, a rename, a re-export, a dynamic import bound to
 *      a different name, `export const x = cache(async () => auth())`. The
 *      scan does not chase each; it BANS every way but a named, unaliased
 *      `import { auth } from "@/lib/auth"` (and the destructured dynamic import
 *      lib/areaAccess.ts needs), and attributes a reader to the whole
 *      top-level declaration that mentions `auth`, so a wrapper is found under
 *      the name it is exported as. A form it cannot follow fails here.
 *   2. THE app/ EXEMPTION IS EXACT. See APP_ROLE_ONLY below.
 *   3. THE DOMAIN IS THE REPOSITORY, not a list of folders — see
 *      tests/helpers/sessionReaderScan.ts.
 */

const domain = sessionDomain();

// --- The app/ exemption --------------------------------------------------

/**
 * EXEMPTION: pages and layouts under app/ that use `auth()` and read nothing
 * off the session but its `role`. They get no refusal probe in
 * tests/session-reader-refusal.test.ts.
 *
 * Counted at 2fafab0 (the tree this change is built on; it touches no file
 * under app/), by parsing every .ts/.tsx under app/ and keeping those with a
 * top-level declaration that mentions the `auth` imported from
 * "@/lib/auth": 26 files. Of the 27 under app/ that import lib/auth, one —
 * app/api/auth/[...nextauth]/route.ts — imports `handlers` and reads nothing.
 * Of the 26: 23 below, 3 in APP_BEYOND_ROLE.
 *
 * The test below does not trust this list: each file is re-parsed, and one
 * that reads anything but `x.user.role` off the result of `auth()` fails.
 */
const APP_ROLE_ONLY = {
  reason:
    "These files read the role to decide what to RENDER or whether to redirect — `can(role, capability)` and `getAdminAccess(role)` — and nothing else off the session. " +
    "A session the gate voids is `auth()` = null, so the role is undefined, and `hasMinRole(undefined, …)` is false: they fall into their no-permission branch by construction, " +
    "so there is no refusal left to prove per file. They also fetch nothing on the strength of the session itself: their data goes through actions and repositories behind " +
    "getAccessContext / requireAreaOrRedirect / resolveProjectSectionAccess, all of which are probed in tests/session-reader-refusal.test.ts.",
  endsWhen:
    "A file reads anything else off the session (this test then refuses it and says so — it moves to APP_BEYOND_ROLE, or gets a probe), OR `hasMinRole` / `getAdminAccess` " +
    "stop being false for an undefined role (then every file here needs its own probe), OR app/ pages stop calling `auth()` directly because their role comes from a guard helper " +
    "(then the set is empty and this exemption is deleted).",
  files: [
    "app/admin/settings/layout.tsx",
    "app/clients/activity/page.tsx",
    "app/clients/add/page.tsx",
    "app/clients/contacts/import/page.tsx",
    "app/clients/import/page.tsx",
    "app/clients/page.tsx",
    "app/clients/trash/page.tsx",
    "app/clients/[id]/edit/page.tsx",
    "app/clients/[id]/page.tsx",
    "app/clients/[id]/projects/add/page.tsx",
    "app/clients/[id]/projects/[projectId]/edit/page.tsx",
    "app/clients/[id]/projects/[projectId]/files/page.tsx",
    "app/clients/[id]/projects/[projectId]/interventions/page.tsx",
    "app/clients/[id]/projects/[projectId]/page.tsx",
    "app/clients/[id]/projects/[projectId]/reserves/page.tsx",
    "app/clients/[id]/projects/[projectId]/tasks/page.tsx",
    "app/clients/[id]/projects/[projectId]/workforce/page.tsx",
    "app/loans/page.tsx",
    "app/projects/activity/page.tsx",
    "app/projects/add/page.tsx",
    "app/projects/import/page.tsx",
    "app/projects/page.tsx",
    "app/projects/trash/page.tsx",
  ],
} as const;

/**
 * NOT exempt: the three app/ files that use `auth()` and read MORE than the
 * role. Listed rather than exempted so the debt stays visible and the suite
 * stays exact — a fourth such file fails here instead of slipping into the
 * exemption above. Each fails closed on a voided session today (checked by
 * reading the file), but "checked by reading" is not a probe.
 */
const APP_BEYOND_ROLE = {
  reason:
    "Each reads the session for more than the role. None fetches data on the strength of it, and each falls to its logged-out branch when `auth()` is null — " +
    "but that is a reading of the code, not a probe, so they are not covered by the exemption.",
  endsWhen:
    "Each file gets its own noSession probe in SESSION_READERS, or its extra read moves behind a guard (blockClientFromApp already does the presence check for the sibling pages), " +
    "or it becomes role-only — this test then refuses it here and says to move it to APP_ROLE_ONLY.",
  files: {
    "app/acces-refuse/page.tsx":
      "session presence (`!session?.user` → /login) and the role (CLIENT → /portail)",
    "app/admin/settings/utilisateurs/page.tsx":
      "the caller's e-mail (`session?.user?.email`, handed to UsersManager to mark the caller's own row), behind requireAdminTab('users')",
    "app/layout.tsx":
      "session presence (`!session` / `!!session`: which nav links and whether the logout button render)",
  },
} as const;

describe("session readers — domain discovery", () => {
  it("the walk reaches the folders that hold session readers (named witnesses, not a floor)", () => {
    for (const witness of ["lib/auth.ts", "lib/accessContext.ts", "actions/users/users.ts", "app/layout.tsx", "proxy.ts"]) {
      expect(domain.paths, witness).toContain(witness);
    }
  });

  it("nothing reaches lib/auth except by a named, unaliased import of auth, handlers, signIn or signOut", () => {
    const offenders = domain.files.flatMap(({ rel, source }) =>
      authImportFormViolationsIn(source, rel).map((finding) => `${rel}:${finding.line}: ${finding.message}`)
    );
    expect(
      offenders,
      offenders.length
        ? `These reach lib/auth by a form the reader discovery cannot follow, so a session reader could hide behind them:\n` +
            offenders.map((o) => `  - ${o}`).join("\n") +
            `\n\nUse \`import { auth } from "@/lib/auth"\` and read the session in a plain top-level function.`
        : undefined
    ).toEqual([]);
  });
});

describe("session readers — the app/ exemption", () => {
  const appFiles = domain.files.filter(({ rel }) => rel.startsWith("app/"));
  const exemptPaths: string[] = [...APP_ROLE_ONLY.files];
  const beyondPaths = Object.keys(APP_BEYOND_ROLE.files);

  it("the app/ files that use auth() are exactly the exempt ones plus the listed non-exempt ones", () => {
    const discovered = appFiles
      .filter(({ rel, source }) => sessionReaderNamesIn(source, rel).length > 0)
      .map(({ rel }) => rel)
      .sort();
    expect(
      discovered,
      `A file under app/ now reads (or no longer reads) the session. If it reads only \`session.user.role\`, add it to APP_ROLE_ONLY; ` +
        `otherwise it needs its own noSession probe in tests/session-reader-refusal.test.ts.\n\nThe exemption holds because: ${APP_ROLE_ONLY.reason}\n\n` +
        `The files kept out of it, and why: ${APP_BEYOND_ROLE.reason}`
    ).toEqual([...exemptPaths, ...beyondPaths].sort());
  });

  it("an exempt file is listed once, and not also listed as non-exempt", () => {
    expect(new Set(exemptPaths).size).toBe(exemptPaths.length);
    expect(exemptPaths.filter((path) => beyondPaths.includes(path))).toEqual([]);
  });

  it("each exempt file reads nothing off the session but the role", () => {
    const offenders = appFiles
      .filter(({ rel }) => exemptPaths.includes(rel))
      .flatMap(({ rel, source }) => sessionReadsBeyondRoleIn(source).map((finding) => `${rel}:${finding.line}: ${finding.message}`));
    expect(
      offenders,
      `These are exempt from a per-reader probe only because they read the role and nothing else. ` +
        `Move each to APP_BEYOND_ROLE, or give it a probe.\n\nThe exemption ends when: ${APP_ROLE_ONLY.endsWhen}`
    ).toEqual([]);
  });

  it("each non-exempt file really does read more than the role (otherwise it belongs to the exemption)", () => {
    const wronglyListed = appFiles
      .filter(({ rel }) => beyondPaths.includes(rel))
      .filter(({ source }) => sessionReadsBeyondRoleIn(source).length === 0)
      .map(({ rel }) => rel);
    expect(wronglyListed, `These read only the role now: move them to APP_ROLE_ONLY.\n\n${APP_BEYOND_ROLE.endsWhen}`).toEqual([]);
  });
});

// --- Probes ----------------------------------------------------------------

function parse(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
}

function forms(text: string, rel = "lib/probe.ts"): string[] {
  return authImportFormViolationsIn(parse(rel, text), rel).map((f) => f.message);
}

function readers(text: string, rel = "lib/probe.ts"): string[] {
  return sessionReaderNamesIn(parse(rel, text), rel);
}

describe("probes — the discovery is proven on planted sources, not assumed", () => {
  describe("the original form: a plain reader is found, so the table in session-reader-refusal must carry it", () => {
    it("a top-level function that calls auth()", () => {
      expect(readers(`import { auth } from "@/lib/auth";\nexport async function whoAmI() { return auth(); }`)).toEqual(["whoAmI"]);
    });
    it("a const arrow that calls auth()", () => {
      expect(readers(`import { auth } from "@/lib/auth";\nexport const whoAmI = async () => (await auth())?.user;`)).toEqual(["whoAmI"]);
    });
  });

  describe("the neighbouring forms that used to escape: each one fails", () => {
    it.each([
      ["namespace import", `import * as authModule from "@/lib/auth";\nexport const f = () => authModule.auth();`, "namespace"],
      ["relative import, from lib/", `import { auth } from "./auth";\nexport const f = () => auth();`, "relative import"],
      ["relative import, from another folder", `import { auth } from "../lib/auth";\nexport const f = () => auth();`, "relative import", "actions/probe.ts"],
      ["relative import with an extension", `import { auth } from "./auth.ts";\nexport const f = () => auth();`, "relative import"],
      ["renamed import", `import { auth as getSession } from "@/lib/auth";\nexport const f = () => getSession();`, "renamed"],
      ["default import", `import authModule from "@/lib/auth";\nexport const f = () => authModule;`, "default import"],
      ["side-effect import", `import "@/lib/auth";`, "side-effect"],
      ["an export lib/auth does not offer for this", `import { unstable_update } from "@/lib/auth";\nexport const f = unstable_update;`, "does not export"],
      ["re-export of auth", `export { auth } from "@/lib/auth";`, "re-export"],
      ["re-export of everything", `export * from "@/lib/auth";`, "re-export"],
      ["require()", `const { auth } = require("@/lib/auth");\nexport const f = () => auth();`, "require"],
      ["import = require()", `import authModule = require("@/lib/auth");\nexport const f = () => authModule.auth();`, "import x = require"],
      [
        "dynamic import bound to a different name",
        `export async function f() { const { auth: whoAmI } = await import("@/lib/auth"); return whoAmI(); }`,
        "dynamic import",
      ],
      [
        "dynamic import kept as a module object",
        `export async function f() { const authModule = await import("@/lib/auth"); return authModule.auth(); }`,
        "dynamic import",
      ],
      [
        "dynamic import chained with .then",
        `export const f = () => import("@/lib/auth").then((m) => m.auth());`,
        "dynamic import",
      ],
      [
        "dynamic import renamed inside Promise.all",
        `export async function f() { const [{ auth: whoAmI }] = await Promise.all([import("@/lib/auth")]); return whoAmI(); }`,
        "dynamic import",
      ],
    ])("%s", (_label, text, expected, rel = "lib/probe.ts") => {
      const messages = forms(text, rel);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join("\n")).toContain(expected);
    });

    it("`export const x = cache(async () => auth())` is found as `x`, however it is re-exported afterwards", () => {
      const text = `import { cache } from "react";\nimport { auth } from "@/lib/auth";\nexport const getSession = cache(async () => auth());\nexport { getSession as currentSession };`;
      expect(forms(text)).toEqual([]);
      expect(readers(text)).toEqual(["getSession"]);
    });

    it("`export { auth }` / `export { auth as x }`, which hand the reader on under another name, are found at module level", () => {
      for (const text of [`import { auth } from "@/lib/auth";\nexport { auth };`, `import { auth } from "@/lib/auth";\nexport { auth as currentSession };`]) {
        expect(readers(text)).toEqual([expect.stringContaining("module level")]);
      }
    });

    it("auth passed around as a value is found under the declaration holding it", () => {
      expect(readers(`import { auth } from "@/lib/auth";\nexport const handle = auth;`)).toEqual(["handle"]);
      expect(readers(`import { auth } from "@/lib/auth";\nexport const f = () => run(auth);`)).toEqual(["f"]);
    });
  });

  describe("the correct forms stay green", () => {
    it.each([
      [`import { auth } from "@/lib/auth";`],
      [`import { handlers } from "@/lib/auth";`],
      [`import { signIn, signOut } from "@/lib/auth";`],
      [`import type { auth } from "@/lib/auth";`],
      [`export async function f() { const { auth } = await import("@/lib/auth"); return auth(); }`],
      [
        `export async function f() { const [{ redirect }, { auth }, { getAdminAccess }] = await Promise.all([import("next/navigation"), import("@/lib/auth"), import("@/lib/adminAccess")]); return auth(); }`,
      ],
      [`import { thing } from "./authorize";\nimport { x } from "@/lib/authz";\nimport { y } from "next-auth";`],
    ])("%s", (text) => {
      expect(forms(text)).toEqual([]);
    });

    it("a dynamic import destructured in Promise.all is still found as a reader", () => {
      const text = `export async function f() { const [{ redirect }, { auth }] = await Promise.all([import("next/navigation"), import("@/lib/auth")]); return auth(); }`;
      expect(readers(text)).toEqual(["f"]);
    });

    it("the word `auth` as a property, a type query or a JSX prop is not a read", () => {
      const text = [
        `import { auth } from "@/lib/auth";`,
        `type Session = Awaited<ReturnType<typeof auth>>;`,
        `export function a(o: { auth: number }) { return o.auth; }`,
        `export const c = { auth: 1 };`,
        `export const d = <Widget auth={1} />;`,
      ].join("\n");
      expect(readers(text, "lib/probe.tsx")).toEqual([]);
    });

    it("the scan is scope-unaware on purpose: a local that shadows `auth` is counted — loud, never silent", () => {
      expect(readers(`import { auth } from "@/lib/auth";\nexport function b(auth: number) { return auth; }`)).toEqual(["b"]);
    });

    it("a file that never imports lib/auth reads no session, whatever it calls auth", () => {
      expect(readers(`export async function auth() { return 1; }\nexport const f = () => auth();`)).toEqual([]);
    });
  });

  describe("the path resolution that decides what counts as lib/auth", () => {
    it.each([
      ["@/lib/auth", "app/page.tsx", true],
      ["@/lib/auth.ts", "app/page.tsx", true],
      ["./auth", "lib/portal.ts", true],
      ["../lib/auth", "actions/probe.ts", true],
      ["../../lib/auth", "actions/users/users.ts", true],
      ["../lib/auth", "actions/users/users.ts", false], // resolves to actions/lib/auth
      ["./auth", "actions/auth/auth.ts", false],
      ["@/lib/authz", "app/page.tsx", false],
      ["@/lib/auth/session", "app/page.tsx", false],
      ["next-auth", "lib/auth.ts", false],
    ])("%s from %s → %s", (specifier, from, expected) => {
      expect(designatesAuthModule(specifier, from)).toBe(expected);
    });
  });

  describe("what the app/ exemption verifies: the role, and only the role", () => {
    const beyond = (text: string) => sessionReadsBeyondRoleIn(parse("app/probe/page.tsx", text)).map((f) => f.message);
    const head = `import { auth } from "@/lib/auth";\nexport default async function Page() {\n`;

    it.each([
      [`const session = await auth();\nreturn session?.user?.role;`],
      [`const session = await auth();\nreturn session.user.role === "CLIENT";`],
      [`const session = await auth();\nconst a = await can(session?.user?.role, "content.edit");\nconst b = await can(session?.user?.role, "content.import");`],
    ])("role only: nothing flagged — %s", (body) => {
      expect(beyond(`${head}${body}\n}`)).toEqual([]);
    });

    it.each([
      ["presence", `const session = await auth();\nreturn !session;`],
      ["the user object", `const session = await auth();\nreturn session?.user;`],
      ["the e-mail", `const session = await auth();\nreturn session?.user?.email;`],
      ["destructuring", `const { user } = (await auth())!;\nreturn user;`],
      ["an unbound result", `return (await auth())?.user?.role;`],
      ["the session handed on", `const session = await auth();\nreturn load(session);`],
    ])("more than the role: %s is flagged", (_label, body) => {
      expect(beyond(`${head}${body}\n}`).length).toBeGreaterThan(0);
    });
  });
});
