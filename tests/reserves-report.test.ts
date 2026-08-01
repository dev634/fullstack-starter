import { describe, it, expect, vi } from "vitest";
import {
  groupPlansForReport,
  summarizeReserves,
  formatCoordinates,
  slugify,
  reportFileName,
  type ReportPlan,
  type ReportReserve,
} from "@/lib/reservesReportData";
import { buildReservesReport, type ReportLabels, type ImageFetcher } from "@/lib/reservesReport";

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

function plan(over: Partial<ReportPlan> = {}): ReportPlan {
  return {
    id: 1,
    name: "RDC",
    url: "https://res.cloudinary.com/demo/image/upload/v1/plans/rdc.pdf",
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
  summaryOpen: "Ouvertes",
  summaryResolved: "Levées",
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

/** Count page objects in the raw PDF ("/Type /Pages" is the tree, not a page). */
function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

const baseInput = {
  project: { name: "Toiture Nord", businessNumber: "AFF-2026-001", address: "12 rue des Lilas" },
  companyName: "ACME BTP",
  locale: "fr-FR",
  labels,
  generatedAt: new Date("2026-07-31T10:00:00Z"),
};

describe("buildReservesReport", () => {
  it("produces a valid PDF and requests the rasterised plan page + resized photo", async () => {
    const fetchImage = vi.fn<ImageFetcher>(async () => PNG_1X1);
    const plans = [
      plan({
        id: 1,
        folderId: null,
        reserves: [
          reserve({ id: 1, description: "Fissure", photos: [{ id: 1, url: "https://res.cloudinary.com/demo/image/upload/v1/p/a.jpg" }] }),
          reserve({ id: 2, status: "RESOLVED", latitude: 48.8566, longitude: 2.3522 }),
        ],
      }),
    ];

    const pdf = await buildReservesReport({ ...baseInput, folders: [], plans, fetchImage });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString().trim()).toBe("%%EOF");
    expect(pdf.byteLength).toBeGreaterThan(1000);

    const requested = fetchImage.mock.calls.map((c) => c[0]);
    // The plan is a PDF stored as an image resource: page 1 must be requested
    // as a JPG, otherwise pdfkit has nothing it can embed.
    expect(requested[0]).toContain("pg_1,f_jpg");
    expect(requested[0]).toMatch(/\.jpg$/);
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
    const shared = { id: 1, url: "https://res.cloudinary.com/demo/image/upload/v1/p/shared.jpg" };
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
});
