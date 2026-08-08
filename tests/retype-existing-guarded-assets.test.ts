import { describe, it, expect } from "vitest";
import {
  chunk,
  runInBatches,
  looksLikeNotFound,
  extractVersion,
  describeError,
  groupByProject,
  grandTotals,
  formatDryRunReport,
  formatExecutionSummary,
  parseArgs,
  readIntFlag,
} from "@/scripts/retype-existing-guarded-assets.mjs";

// Every function exercised here is pure — no Cloudinary call, no database
// access. The IO functions (fetchPending*, markAuthenticated, processAsset,
// main) are NOT covered: they need a live Cloudinary account and database,
// neither available in this environment. See the script's header.
//
// The script itself is plain JavaScript ESM (no `tsx` at runtime — see its
// header), so it exports no TypeScript types; these two mirror its plain
// object shapes for this test file's own type-checking only.
type PendingAsset = {
  model: "ProjectFile" | "ReservePlan" | "ReservePhoto";
  id: number;
  publicId: string;
  resourceType: "IMAGE" | "VIDEO" | "RAW";
  projectId: number;
  projectName: string;
  projectDeleted: boolean;
};

type Outcome =
  | { status: "flipped"; asset: PendingAsset }
  | { status: "repaired"; asset: PendingAsset }
  | { status: "skipped"; asset: PendingAsset }
  | { status: "failed"; asset: PendingAsset; error: string };

function asset(overrides: Partial<PendingAsset> = {}): PendingAsset {
  return {
    model: "ProjectFile",
    id: 1,
    publicId: "projects/1/devis.pdf",
    resourceType: "RAW",
    projectId: 1,
    projectName: "Toiture Dupont",
    projectDeleted: false,
    ...overrides,
  };
}

describe("chunk", () => {
  it("splits into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds the array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input — the degenerate case", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("throws on a non-positive size instead of looping forever", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe("runInBatches", () => {
  it("never runs more than batchSize workers concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const worker = async (n: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    };

    const results = await runInBatches([1, 2, 3, 4, 5, 6, 7], 3, worker, 0);

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("preserves input order in the results even if workers finish out of order", async () => {
    const delays = [30, 0, 15];
    const worker = (n: number) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(n), delays[n]));

    const results = await runInBatches([0, 1, 2], 3, worker, 0);

    expect(results).toEqual([0, 1, 2]);
  });

  it("handles an empty item list without invoking the worker", async () => {
    let calls = 0;
    const results = await runInBatches([] as number[], 3, async (n: number) => {
      calls += 1;
      return n;
    }, 0);

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("looksLikeNotFound", () => {
  it("is true for Cloudinary's documented 404 shape", () => {
    expect(looksLikeNotFound({ http_code: 404, message: "Resource not found" })).toBe(true);
  });

  it("is true on http_code 404 alone, even with an unrelated message — the design deliberately does not depend on exact wording", () => {
    expect(looksLikeNotFound({ http_code: 404, message: "something else entirely" })).toBe(true);
  });

  it("is false for other HTTP codes (e.g. 420 rate limit, 401 auth)", () => {
    expect(looksLikeNotFound({ http_code: 420, message: "Rate limited" })).toBe(false);
    expect(looksLikeNotFound({ http_code: 401, message: "Invalid Signature" })).toBe(false);
  });

  it("is false for a plain Error instance (no http_code) — the degenerate case of a network-level failure", () => {
    expect(looksLikeNotFound(new Error("socket hang up"))).toBe(false);
  });

  it("is false for null/undefined/non-object errors", () => {
    expect(looksLikeNotFound(null)).toBe(false);
    expect(looksLikeNotFound(undefined)).toBe(false);
    expect(looksLikeNotFound("boom")).toBe(false);
  });
});

describe("extractVersion", () => {
  it("stringifies a numeric version", () => {
    expect(extractVersion({ version: 1712345678 })).toBe("1712345678");
  });

  it("passes through a string version unchanged", () => {
    expect(extractVersion({ version: "1712345678" })).toBe("1712345678");
  });

  it("returns null when the response carries no version — the degenerate case", () => {
    expect(extractVersion({ public_id: "x" })).toBeNull();
  });

  it("returns null for a malformed / non-object response instead of throwing", () => {
    expect(extractVersion(null)).toBeNull();
    expect(extractVersion("not a response")).toBeNull();
  });
});

describe("describeError", () => {
  it("extracts only message + http_code from a Cloudinary-shaped error", () => {
    expect(describeError({ http_code: 404, message: "Resource not found" })).toBe(
      "Resource not found (HTTP 404)"
    );
  });

  it("never surfaces request_options / query_params, even when present on the error — this is the secret-redaction guarantee", () => {
    const dangerousError = {
      http_code: 401,
      message: "Invalid Signature",
      request_options: { auth: "123456789:super-secret-api-key" },
      query_params: "signature=abcdef&api_key=123456789",
    };

    const described = describeError(dangerousError);

    expect(described).toBe("Invalid Signature (HTTP 401)");
    expect(described).not.toContain("super-secret-api-key");
    expect(described).not.toContain("signature=");
  });

  it("falls back to a plain Error's message", () => {
    expect(describeError(new Error("socket hang up"))).toBe("socket hang up");
  });

  it("falls back to the raw string when a string is thrown", () => {
    expect(describeError("boom")).toBe("boom");
  });

  it("has a stable fallback for a totally unrecognizable error — the degenerate case", () => {
    expect(describeError(null)).toBe("Erreur inconnue");
    expect(describeError(undefined)).toBe("Erreur inconnue");
    expect(describeError(42)).toBe("Erreur inconnue");
  });
});

describe("groupByProject / grandTotals", () => {
  it("returns an empty report for an empty input — the degenerate case (nothing pending)", () => {
    expect(groupByProject([])).toEqual([]);
    expect(grandTotals([])).toEqual({
      counts: { ProjectFile: 0, ReservePlan: 0, ReservePhoto: 0 },
      total: 0,
    });
  });

  it("groups mixed models under the same project and sums totals per model and overall", () => {
    const assets: PendingAsset[] = [
      asset({ model: "ProjectFile", id: 1, projectId: 1, projectName: "Toiture Dupont" }),
      asset({ model: "ProjectFile", id: 2, projectId: 1, projectName: "Toiture Dupont" }),
      asset({ model: "ReservePlan", id: 3, projectId: 1, projectName: "Toiture Dupont" }),
      asset({ model: "ReservePhoto", id: 4, projectId: 2, projectName: "Hangar Martin" }),
    ];

    const groups = groupByProject(assets);

    expect(groups).toEqual([
      {
        projectId: 2,
        projectName: "Hangar Martin",
        projectDeleted: false,
        counts: { ProjectFile: 0, ReservePlan: 0, ReservePhoto: 1 },
        total: 1,
      },
      {
        projectId: 1,
        projectName: "Toiture Dupont",
        projectDeleted: false,
        counts: { ProjectFile: 2, ReservePlan: 1, ReservePhoto: 0 },
        total: 3,
      },
    ]);

    expect(grandTotals(assets)).toEqual({
      counts: { ProjectFile: 2, ReservePlan: 1, ReservePhoto: 1 },
      total: 4,
    });
  });

  it("sorts by project name, then by id when names tie", () => {
    const assets: PendingAsset[] = [
      asset({ id: 1, projectId: 20, projectName: "Alpha" }),
      asset({ id: 2, projectId: 5, projectName: "Alpha" }),
      asset({ id: 3, projectId: 1, projectName: "Beta" }),
    ];

    expect(groupByProject(assets).map((g) => g.projectId)).toEqual([5, 20, 1]);
  });

  it("carries the deleted-project flag through — the degenerate case of a soft-deleted project still holding public assets", () => {
    const groups = groupByProject([asset({ projectDeleted: true })]);
    expect(groups[0].projectDeleted).toBe(true);
  });
});

describe("formatDryRunReport", () => {
  it("states clearly that nothing was changed and how to actually run it", () => {
    const lines = formatDryRunReport([asset()]).join("\n");
    expect(lines).toContain("DRY RUN");
    expect(lines).toContain("--execute");
  });

  it("includes per-project counts and the grand total", () => {
    const assets = [
      asset({ model: "ProjectFile", id: 1 }),
      asset({ model: "ReservePlan", id: 2 }),
    ];
    const lines = formatDryRunReport(assets).join("\n");

    expect(lines).toContain("Toiture Dupont");
    expect(lines).toContain("ProjectFile: 1");
    expect(lines).toContain("ReservePlan: 1");
    expect(lines).toContain("Total general: 2");
  });

  it("reports zero totals for an empty input rather than an empty/blank report", () => {
    const lines = formatDryRunReport([]).join("\n");
    expect(lines).toContain("Total general: 0");
    expect(lines).toContain("Projets concernes: 0");
  });
});

describe("formatExecutionSummary", () => {
  it("tallies each outcome status correctly", () => {
    const outcomes: Outcome[] = [
      { status: "flipped", asset: asset({ id: 1 }) },
      { status: "flipped", asset: asset({ id: 2 }) },
      { status: "repaired", asset: asset({ id: 3 }) },
      { status: "skipped", asset: asset({ id: 4 }) },
      { status: "failed", asset: asset({ id: 5, publicId: "projects/1/broken" }), error: "boom (HTTP 500)" },
    ];

    const lines = formatExecutionSummary(outcomes).join("\n");

    expect(lines).toContain("Bascules (rename + update): 2");
    expect(lines).toContain("Repares (deja renommes lors d'un run precedent, ligne remise a jour): 1");
    expect(lines).toContain("Ignores (deja a jour, probablement un run concurrent): 1");
    expect(lines).toContain("Echoues: 1");
    expect(lines).toContain("ProjectFile#5");
    expect(lines).toContain('publicId="projects/1/broken"');
    expect(lines).toContain("boom (HTTP 500)");
  });

  it("omits the failures section entirely when there are none", () => {
    const outcomes: Outcome[] = [{ status: "flipped", asset: asset() }];
    const lines = formatExecutionSummary(outcomes).join("\n");
    expect(lines).not.toContain("Echecs");
  });

  it("handles an empty outcome list — the degenerate case of every row already having been flipped by a prior run", () => {
    const lines = formatExecutionSummary([]).join("\n");
    expect(lines).toContain("Bascules (rename + update): 0");
    expect(lines).toContain("Echoues: 0");
  });
});

describe("readIntFlag / parseArgs", () => {
  it("defaults to dry-run with the built-in concurrency/pause when no flags are given", () => {
    expect(parseArgs([])).toEqual({ execute: false, concurrency: 4, pauseMs: 300 });
  });

  it("turns on execute only via --execute, never implicitly", () => {
    expect(parseArgs(["--dry-run"]).execute).toBe(false);
    expect(parseArgs(["--execute"]).execute).toBe(true);
  });

  it("reads --concurrency and --pause-ms overrides", () => {
    expect(parseArgs(["--execute", "--concurrency=2", "--pause-ms=1000"])).toEqual({
      execute: true,
      concurrency: 2,
      pauseMs: 1000,
    });
  });

  it("falls back to the default on a non-numeric or non-positive override rather than crashing", () => {
    expect(readIntFlag(["--concurrency=abc"], "--concurrency")).toBeNull();
    expect(readIntFlag(["--concurrency=0"], "--concurrency")).toBeNull();
    expect(readIntFlag(["--concurrency=-3"], "--concurrency")).toBeNull();
  });

  it("returns null when the flag is absent — the degenerate case", () => {
    expect(readIntFlag([], "--concurrency")).toBeNull();
  });
});
