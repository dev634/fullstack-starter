import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { dashboardReportFileName } from "@/lib/dashboardReportData";
import {
  buildTasksReport,
  buildInterimsReport,
  buildCompaniesReport,
  buildMaterialsReport,
  buildGlobalDashboardReport,
  type DashboardReportChrome,
  type TasksReportLabels,
  type AssigneeReportLabels,
  type MaterialsReportLabels,
} from "@/lib/dashboardReport";
import { pageCount } from "./helpers/pdf";

describe("dashboardReportFileName", () => {
  it("builds a dated filename with the given section prefix", () => {
    const date = new Date("2026-07-31T10:00:00Z");
    expect(dashboardReportFileName("taches", "Toiture Nord", date)).toBe("taches-toiture-nord-2026-07-31.pdf");
  });

  it("falls back when the project name has no usable chars", () => {
    const date = new Date("2026-07-31T10:00:00Z");
    expect(dashboardReportFileName("materiel", "!!!", date)).toBe("materiel-projet-2026-07-31.pdf");
  });
});

const project = { name: "Toiture Nord", businessNumber: "AFF-2026-001", address: "12 rue des Lilas" };
const companyName = "ACME BTP";
const locale = "fr-FR";
const generatedAt = new Date("2026-07-31T10:00:00Z");

const chrome: DashboardReportChrome = {
  generatedOn: "Édité le",
  total: "Total",
  done: "Terminées",
  percent: "Avancement",
  percentValue: "{value} %",
  page: "Page {current} / {total}",
  businessNumber: "N° d'affaire",
  address: "Adresse",
};

const tasksLabels: TasksReportLabels = {
  title: "Avancement des tâches",
  overall: "Ensemble du projet",
  categoriesTitle: "Avancement par catégorie / groupe",
  detailedTitle: "Avancement détaillé, tâche par tâche",
  none: "Aucune tâche pour le moment.",
  rowStats: "{percent} % ({done}/{total})",
};

const assigneeLabels: AssigneeReportLabels = {
  title: "Avancement par intérimaire",
  none: "Aucune tâche, série ou catégorie assignée pour le moment.",
  rowStats: "{percent} % ({done}/{total})",
};

const materialsLabels: MaterialsReportLabels = {
  title: "Stock matériel",
  listTitle: "Détail par matériau",
  none: "Aucun matériel lié à une tâche pour le moment.",
  stockStatus: { green: "Stock suffisant", orange: "Stock partiel", red: "Rupture de stock" },
};

/** The exact `scn` fill-colour operator pdfkit emits for a #RRGGBB hex — see
 * tests/reserves-report.test.ts's own copy of this helper for the full
 * rationale (kept duplicated: it's a 4-line pure function, not the mechanics
 * this PR set out to extract). */
function decompressedContent(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    try {
      out += inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      // Not a Flate-compressed stream — skip.
    }
  }
  return out;
}

function fillColorOperator(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((c) => c / 255);
  return `${channels.join(" ")} scn`;
}

describe("buildTasksReport", () => {
  it("produces a valid PDF: cover + one content page", async () => {
    const pdf = await buildTasksReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      progress: { done: 6, total: 13, percent: 46.15, groups: [{ id: 1, name: "Toiture", done: 4, total: 10, percent: 40 }] },
      details: [{ id: "task-1", name: "Panneau 1", done: 1, total: 1, percent: 100 }],
      labels: tasksLabels,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(2);
  });

  it("still renders a valid PDF with nothing to show", async () => {
    const pdf = await buildTasksReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      progress: { done: 0, total: 0, percent: 0, groups: [] },
      details: [],
      labels: tasksLabels,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(2);
  });
});

describe("buildInterimsReport / buildCompaniesReport", () => {
  it("lists one row per assignee", async () => {
    const pdf = await buildInterimsReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      rows: [
        { id: 1, name: "Alice Dupont", done: 4, total: 10, percent: 40 },
        { id: 2, name: "Bob Martin", done: 0, total: 0, percent: 0 },
      ],
      labels: assigneeLabels,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(2);
  });

  it("companies report renders the same shape with its own title", async () => {
    const pdf = await buildCompaniesReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      rows: [{ id: 1, name: "Entreprise X", done: 2, total: 4, percent: 50 }],
      labels: { ...assigneeLabels, title: "Avancement par entreprise sous-traitante" },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders the empty state when there is nothing to show, still a valid PDF", async () => {
    const pdf = await buildInterimsReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      rows: [],
      labels: assigneeLabels,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("buildMaterialsReport", () => {
  it("draws a red/orange/green tile per stock status, matching STOCK_HEX", async () => {
    const pdf = await buildMaterialsReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      materials: [
        { id: 1, name: "Panneaux", quantity: 0, requiredQuantity: 24, status: "red" },
        { id: 2, name: "Onduleurs", quantity: 5, requiredQuantity: 10, status: "orange" },
        { id: 3, name: "Câbles", quantity: 100, requiredQuantity: 100, status: "green" },
      ],
      labels: materialsLabels,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const content = decompressedContent(pdf);
    expect(content).toContain(fillColorOperator("#ef4444")); // red
    expect(content).toContain(fillColorOperator("#f59e0b")); // orange
    expect(content).toContain(fillColorOperator("#22c55e")); // green
  });
});

describe("buildGlobalDashboardReport", () => {
  it("draws exactly one page per section the caller may see, plus the cover", async () => {
    const pdf = await buildGlobalDashboardReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      title: "Rapport complet du tableau de bord",
      sections: {
        tasks: {
          progress: { done: 1, total: 1, percent: 100, groups: [] },
          details: [{ id: "task-1", name: "Tâche", done: 1, total: 1, percent: 100 }],
          labels: tasksLabels,
        },
        materials: {
          materials: [{ id: 1, name: "Panneaux", quantity: 0, requiredQuantity: 24, status: "red" }],
          labels: materialsLabels,
        },
      },
    });

    // Cover + tasks + materials = 3 — no page at all for interims/companies/
    // réserves, which the caller never included in `sections`. This is the
    // unit-level proof that the combined report only ever draws what it's
    // handed; the route handler is what decides WHICH sections that is
    // (canAccessSection per section, mirrored from the dashboard page).
    expect(pageCount(pdf)).toBe(3);
  });

  it("renders a bare cover when the caller may see no section at all", async () => {
    const pdf = await buildGlobalDashboardReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      title: "Rapport complet du tableau de bord",
      sections: {},
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("draws the réserves tally section using this project's configured status colours", async () => {
    const pdf = await buildGlobalDashboardReport({
      project,
      companyName,
      locale,
      generatedAt,
      chrome,
      title: "Rapport complet du tableau de bord",
      sections: {
        reserves: {
          tally: { total: 3, open: 2, resolved: 1 },
          statusColors: { open: "#ff8800", resolved: "#059669" },
          labels: { title: "Avancement des réserves", none: "Aucune réserve pour le moment.", total: "Total", open: "Ouvertes", resolved: "Levées" },
        },
      },
    });
    expect(pageCount(pdf)).toBe(2);
  });
});
