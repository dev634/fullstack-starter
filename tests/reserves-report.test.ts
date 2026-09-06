import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { inflateSync } from "node:zlib";
import { v2 as cloudinary } from "cloudinary";
import {
  groupPlansForReport,
  summarizeReserves,
  formatCoordinates,
  slugify,
  reportFileName,
  type ReportPlan,
  type ReportPhoto,
  type ReportReserve,
} from "@/lib/reservesReportData";
import { buildReservesReport, fetchRemoteImage, type ReportLabels, type ImageFetcher } from "@/lib/reservesReport";
import type { DeliveryAsset } from "@/lib/cloudinaryDelivery";
import { pageCount } from "./helpers/pdf";

// buildReservesReport now signs its own delivery URLs (buildDeliveryUrl) —
// fixed, fake credentials make that fully deterministic here, independent of
// whatever CLOUDINARY_URL happens to be set to in this environment. Same
// rationale as tests/cloudinaryDelivery.test.ts.
beforeAll(() => {
  cloudinary.config({ cloud_name: "demo", api_key: "123456789", api_secret: "test-secret", secure: true });
});

function asset(over: Partial<DeliveryAsset> = {}): DeliveryAsset {
  return {
    publicId: "projects/2/plans/rdc",
    resourceType: "IMAGE",
    format: "pdf",
    version: "1699999999",
    deliveryType: "AUTHENTICATED",
    ...over,
  };
}

let nextNumber = 1;
function reserve(over: Partial<ReportReserve> = {}): ReportReserve {
  return {
    id: 1,
    number: nextNumber++,
    x: 0.5,
    y: 0.5,
    description: "Fissure sur le mur",
    status: "OPEN",
    latitude: null,
    longitude: null,
    photos: [],
    ...over,
  };
}

function photo(over: Partial<ReportPhoto> = {}): ReportPhoto {
  return {
    id: 1,
    asset: asset({ publicId: "projects/2/reserve-photos/a", format: "jpg" }),
    ...over,
  };
}

function plan(over: Partial<ReportPlan> = {}): ReportPlan {
  return {
    id: 1,
    name: "RDC",
    asset: asset(),
    folderId: null,
    reserves: [],
    ...over,
  };
}

describe("groupPlansForReport", () => {
  it("puts root plans first, then each folder in order", () => {
    const folders = [
      { id: 10, name: "Bâtiment A" },
      { id: 20, name: "Bâtiment B" },
    ];
    const plans = [
      plan({ id: 1, folderId: 20 }),
      plan({ id: 2, folderId: null }),
      plan({ id: 3, folderId: 10 }),
    ];

    const groups = groupPlansForReport(folders, plans);

    expect(groups.map((g) => g.folder?.name ?? null)).toEqual([null, "Bâtiment A", "Bâtiment B"]);
    expect(groups[0].plans.map((p) => p.id)).toEqual([2]);
    expect(groups[1].plans.map((p) => p.id)).toEqual([3]);
    expect(groups[2].plans.map((p) => p.id)).toEqual([1]);
  });

  it("skips folders that hold no plan", () => {
    const groups = groupPlansForReport([{ id: 10, name: "Vide" }], [plan({ folderId: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBeNull();
  });

  it("omits the root group entirely when every plan is filed", () => {
    const groups = groupPlansForReport([{ id: 10, name: "A" }], [plan({ folderId: 10 })]);
    expect(groups.map((g) => g.folder?.name)).toEqual(["A"]);
  });

  it("falls back to the root for a plan pointing at an unknown folder", () => {
    // A réserve silently missing from a snagging report is worse than one
    // filed under the wrong heading, so orphans must still be rendered.
    const groups = groupPlansForReport([{ id: 10, name: "A" }], [plan({ id: 7, folderId: 999 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBeNull();
    expect(groups[0].plans.map((p) => p.id)).toEqual([7]);
  });
});

describe("summarizeReserves", () => {
  it("tallies open and resolved across every plan", () => {
    const plans = [
      plan({ reserves: [reserve({ status: "OPEN" }), reserve({ status: "RESOLVED" })] }),
      plan({ reserves: [reserve({ status: "OPEN" })] }),
    ];
    expect(summarizeReserves(plans)).toEqual({ total: 3, open: 2, resolved: 1 });
  });

  it("returns zeroes with no plans", () => {
    expect(summarizeReserves([])).toEqual({ total: 0, open: 0, resolved: 0 });
  });

  it("accepts a plain repository row shape, not just a fully-shaped ReportPlan", () => {
    // repository/reservePlans.ts::findByProject() rows have no `asset` on
    // their plans/photos (that composition only happens for the PDF report) —
    // this must still typecheck and tally correctly, since the project page
    // and the client portal feed it their raw findByProject() result.
    const rawPlans = [
      { id: 1, reserves: [{ status: "OPEN" as const }, { status: "RESOLVED" as const }] },
      { id: 2, reserves: [{ status: "OPEN" as const }] },
    ];
    expect(summarizeReserves(rawPlans)).toEqual({ total: 3, open: 2, resolved: 1 });
  });

  it("tallies a single plan the same way whether called alone or as part of a larger list", () => {
    // ReservesSection's per-plan "N open" row counter calls this with a
    // one-plan array (summarizeReserves([p])) instead of a dedicated
    // per-plan helper — this must match what the same plan contributes
    // inside a multi-plan call.
    const a = plan({ id: 1, reserves: [reserve({ status: "OPEN" }), reserve({ status: "RESOLVED" })] });
    const b = plan({ id: 2, reserves: [reserve({ status: "OPEN" })] });
    expect(summarizeReserves([a])).toEqual({ total: 2, open: 1, resolved: 1 });
    expect(summarizeReserves([b])).toEqual({ total: 1, open: 1, resolved: 0 });
    expect(summarizeReserves([{ id: 3, reserves: [] }])).toEqual({ total: 0, open: 0, resolved: 0 });
  });
});

describe("formatCoordinates", () => {
  it("formats a GPS pair at fixed precision", () => {
    expect(formatCoordinates(48.8566, 2.3522)).toBe("48.856600, 2.352200");
  });

  it("returns null when either half is missing", () => {
    expect(formatCoordinates(48.8566, null)).toBeNull();
    expect(formatCoordinates(null, 2.3522)).toBeNull();
    expect(formatCoordinates(null, null)).toBeNull();
  });

  it("keeps a zero coordinate rather than treating it as absent", () => {
    expect(formatCoordinates(0, 0)).toBe("0.000000, 0.000000");
  });
});

describe("slugify / reportFileName", () => {
  it("folds accents and collapses punctuation", () => {
    expect(slugify("Toiture Nord — Bâtiment A/2")).toBe("toiture-nord-batiment-a-2");
  });

  it("never leaves a trailing dash after truncation", () => {
    expect(slugify("a".repeat(10) + " " + "b".repeat(80), 11)).toBe("aaaaaaaaaa");
  });

  it("strips anything that could break out of the Content-Disposition header", () => {
    // The project name is attacker-influenced and lands in a response header,
    // so the filename must never carry CRLF, quotes, or path separators.
    const nasty = 'evil"\r\nX-Injected: 1\r\n\r\n../../etc/passwd';
    const name = reportFileName(nasty, new Date("2026-07-31T10:00:00Z"));
    expect(name).toMatch(/^reserves-[a-z0-9-]*-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(name).not.toMatch(/[\r\n"'\\/]/);
  });

  it("builds a dated filename, falling back when the name has no usable chars", () => {
    const date = new Date("2026-07-31T10:00:00Z");
    expect(reportFileName("Toiture Nord", date)).toBe("reserves-toiture-nord-2026-07-31.pdf");
    expect(reportFileName("!!!", date)).toBe("reserves-projet-2026-07-31.pdf");
  });
});

const labels: ReportLabels = {
  title: "Rapport de réserves",
  businessNumber: "N° d'affaire",
  address: "Adresse",
  generatedOn: "Édité le",
  total: "Total",
  statusOpen: "Ouverte",
  statusResolved: "Levée",
  rootGroup: "Sans dossier",
  noReserves: "Aucune réserve sur ce plan.",
  gps: "Position GPS",
  planUnavailable: "Le plan n'a pas pu être chargé.",
  page: "Page {current} / {total}",
};

// 1x1 PNG — enough for pdfkit to decode and measure.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const baseInput = {
  project: { name: "Toiture Nord", businessNumber: "AFF-2026-001", address: "12 rue des Lilas" },
  companyName: "ACME BTP",
  locale: "fr-FR",
  labels,
  // Deliberately NOT the product default pair (#e11d48/#16a34a, see
  // lib/reserveStatusStyle.ts) — a fixture using the exact default doesn't
  // distinguish "honours this project's configuration" from "silently
  // replays the hard-coded default regardless of what's passed in", which is
  // exactly the regression the "draws THIS project's configured colours"
  // test below exists to catch. Same non-default pair
  // tests/reserve-status-style-schema.test.ts already uses.
  statusColors: { open: "#ff8800", resolved: "#059669" },
  generatedAt: new Date("2026-07-31T10:00:00Z"),
};

/** pdfkit Flate-compresses every page content stream by default — this pulls
 * the raw drawing operators back out so a test can grep for a specific
 * fillColor operator. The only way to prove the report actually drew a
 * project's CONFIGURED colour rather than the hard-coded default, now that
 * baseInput.statusColors above is deliberately not that default pair. */
function decompressedContent(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    try {
      out += inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      // Not a Flate-compressed stream (an embedded image XObject, e.g.) — skip.
    }
  }
  return out;
}

/** The exact `scn` fill-colour operator pdfkit emits for a #RRGGBB hex —
 * `_normalizeColor` divides each channel by 255 with no rounding, so this
 * must match its raw float-to-string output exactly (verified against the
 * real pdfkit output, not just derived independently — see this test's own
 * assertions). */
function fillColorOperator(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((c) => c / 255);
  return `${channels.join(" ")} scn`;
}

describe("fetchRemoteImage", () => {
  const SIGNED_URL =
    "https://res.cloudinary.com/demo/image/authenticated/s--supersecretsig--/v1699999999/projects/2/plans/rdc.jpg";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs the status and host — never the signed URL — when Cloudinary answers with a non-OK status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));

    const result = await fetchRemoteImage(SIGNED_URL);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({ status: 401, host: "res.cloudinary.com" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("supersecretsig");
    errorSpy.mockRestore();
  });

  it("logs the host — never the signed URL — when the fetch itself throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchRemoteImage(SIGNED_URL);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({ host: "res.cloudinary.com" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("supersecretsig");
    errorSpy.mockRestore();
  });

  it("stays silent for a host outside the allowlist — never even attempted, not a fetch failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await fetchRemoteImage("https://evil.example.com/x.jpg");
    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("buildReservesReport", () => {
  it("produces a valid PDF and requests the rasterised plan page + resized photo", async () => {
    const fetchImage = vi.fn<ImageFetcher>(async () => PNG_1X1);
    const plans = [
      plan({
        id: 1,
        folderId: null,
        reserves: [
          reserve({ id: 1, description: "Fissure", photos: [photo()] }),
          reserve({ id: 2, status: "RESOLVED", latitude: 48.8566, longitude: 2.3522 }),
        ],
      }),
    ];

    const pdf = await buildReservesReport({ ...baseInput, folders: [], plans, fetchImage });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString().trim()).toBe("%%EOF");
    expect(pdf.byteLength).toBeGreaterThan(1000);

    const requested = fetchImage.mock.calls.map((c) => c[0]);
    // The plan is a PDF stored as an image resource: page 1 must be requested,
    // delivered as a JPG (via the `format` override, not the stored "pdf"),
    // otherwise pdfkit has nothing it can embed.
    expect(requested[0]).toContain("pg_1");
    expect(requested[0]).toMatch(/\.jpg$/);
    // Matches the guarded delivery route's own transformation for a plan
    // (lib/assetDelivery.ts::buildAssetTransformation) — same width, same
    // crop mode, so this report requests the SAME Cloudinary derivative the
    // on-screen viewer does rather than a second, distinct one.
    expect(requested[0]).toContain("c_limit");
    // Photos are downscaled so the report doesn't embed full-size originals.
    expect(requested[1]).toContain("w_700");
  });

  it("still renders when the plan image can't be fetched", async () => {
    const plans = [plan({ reserves: [reserve()] })];
    const pdf = await buildReservesReport({
      ...baseInput,
      folders: [],
      plans,
      fetchImage: async () => null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders a cover even with no plans at all", async () => {
    const pdf = await buildReservesReport({
      ...baseInput,
      folders: [],
      plans: [],
      fetchImage: async () => null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("emits exactly one page per plan plus the cover — no blank filler pages", async () => {
    // Footers are stamped onto already-laid-out pages; writing below the bottom
    // margin would make pdfkit auto-paginate and append a blank page per stamp.
    const plans = [
      plan({ id: 1, name: "RDC", folderId: null, reserves: [reserve(), reserve()] }),
      plan({ id: 2, name: "R+1", folderId: 10, reserves: [reserve()] }),
    ];
    const pdf = await buildReservesReport({
      ...baseInput,
      folders: [{ id: 10, name: "Bâtiment A" }],
      plans,
      fetchImage: async () => PNG_1X1,
    });
    expect(pageCount(pdf)).toBe(3);
  });

  it("fetches each distinct image once, even when réserves share a photo", async () => {
    const shared = photo({ id: 1, asset: asset({ publicId: "projects/2/reserve-photos/shared", format: "jpg" }) });
    const fetchImage = vi.fn<ImageFetcher>(async () => PNG_1X1);
    const plans = [
      plan({
        id: 1,
        reserves: [
          reserve({ id: 1, photos: [shared] }),
          reserve({ id: 2, photos: [shared] }),
          reserve({ id: 3, photos: [] }),
        ],
      }),
    ];

    await buildReservesReport({ ...baseInput, folders: [], plans, fetchImage });

    // 1 plan page + 1 distinct photo — not one round-trip per réserve.
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("does not fetch anything for a project with no plans", async () => {
    const fetchImage = vi.fn<ImageFetcher>(async () => PNG_1X1);
    await buildReservesReport({ ...baseInput, folders: [], plans: [], fetchImage });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("draws THIS project's configured status colours, not the product default (point 6, PR #196 arbitrage)", async () => {
    const plans = [
      plan({
        id: 1,
        reserves: [reserve({ status: "OPEN" }), reserve({ status: "RESOLVED" })],
      }),
    ];
    const pdf = await buildReservesReport({ ...baseInput, folders: [], plans, fetchImage: async () => PNG_1X1 });
    const content = decompressedContent(pdf);

    expect(content).toContain(fillColorOperator(baseInput.statusColors.open));
    expect(content).toContain(fillColorOperator(baseInput.statusColors.resolved));
    // And never silently falls back to the hard-coded product default either.
    expect(content).not.toContain(fillColorOperator("#e11d48"));
    expect(content).not.toContain(fillColorOperator("#16a34a"));
  });
});
