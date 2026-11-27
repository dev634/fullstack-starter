import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { sourceFilesIn } from "./helpers/astScan";
import { calledIdentifiers, checkStacking, portalsInto, rendersJsx } from "./helpers/stackingScan";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const HOST_ID = "TOAST_HOST_ID";

// Discovery: every .tsx under app/, components/, forms/ (FOREIGN_TREE_DIRS —
// node_modules, .claude — are never entered), parsed as TSX. A "fixed element"
// is a JSX element whose literal className (string, {"…"}, template text
// parts, ternary arms, `||` operands) holds the `fixed` utility, with or
// without a variant. Counted at e6efb9d + this change: 6 overlays (Modal,
// ModalShell, ScanDeliveryNoteModal, EditInterventionForm, EditMaterialForm,
// EditTaskForm) + 1 host (app/layout.tsx). Not resolved: a className built
// from an identifier or a call.
const EXPECTED_OVERLAYS = 6;
const sources = ["app", "components", "forms"]
  .flatMap((d) => sourceFilesIn(`${ROOT}${d}`, [".tsx"]))
  .map((f) => ({ file: relative(ROOT, f).replaceAll("\\", "/"), source: readFileSync(f, "utf8") }));

describe("the toast host stacks above every overlay", () => {
  const verdict = checkStacking(sources, HOST_ID);

  it("has exactly one host, with an explicit z-index above every other fixed element", () => {
    expect(verdict.violations).toEqual([]);
    expect(verdict.hostZ).toBeGreaterThan(Math.max(...verdict.overlays.map((o) => o.z ?? 0)));
  });

  it("carries the host in app/layout.tsx", () => {
    const layout = sources.filter((s) => s.file === "app/layout.tsx");
    expect(layout).toHaveLength(1);
    expect(checkStacking(layout, HOST_ID).hostZ).toBe(verdict.hostZ);
  });

  it(`discovers exactly ${EXPECTED_OVERLAYS} fixed overlays`, () => {
    expect(verdict.overlays).toHaveLength(EXPECTED_OVERLAYS);
  });

  it("renders the toast by portal into that host (a real call, not a comment)", () => {
    expect(portalsInto(read("components/Toast.tsx"), "TOAST_HOST_ID")).toBe(true);
  });

  it("renders Modal and ModalShell through the body portal", () => {
    expect(rendersJsx(read("components/Modal.tsx"), "BodyPortal")).toBe(true);
    expect(rendersJsx(read("components/ModalShell.tsx"), "BodyPortal")).toBe(true);
    expect(calledIdentifiers(read("components/BodyPortal.tsx")).has("createPortal")).toBe(true);
  });
});

describe("probes: the stacking check is not decorative", () => {
  const host = '<div id={TOAST_HOST_ID} className="fixed z-60" />';
  const verdictOf = (overlay: string) =>
    checkStacking(
      [
        { file: "host.tsx", source: `const a = ${host};` },
        { file: "probe.tsx", source: `const b = ${overlay};` },
      ],
      HOST_ID,
    );

  it("1. the original form (fixed, no z-index) goes red", () => {
    expect(verdictOf('<div className="fixed top-32 right-5 left-5" />').violations).not.toEqual([]);
  });

  it("2. the neighbouring forms (template with a variable, ternary, variant) without a z go red", () => {
    expect(verdictOf("<div className={`sm:fixed inset-0 ${x}`} />").violations).not.toEqual([]);
    expect(verdictOf('<div className={open ? "fixed inset-0" : "hidden"} />').violations).not.toEqual([]);
  });

  it("2b. a z at or above the host's goes red", () => {
    expect(verdictOf('<div className="fixed z-60" />').violations).not.toEqual([]);
  });

  it("3. the neighbouring forms WITH a lower z stay green", () => {
    expect(verdictOf("<div className={`sm:fixed inset-0 z-50 ${x}`} />").violations).toEqual([]);
    expect(verdictOf('<div className={open ? "fixed inset-0 z-50" : "hidden"} />').violations).toEqual([]);
  });

  it("4. dropping one overlay from the walk breaks the exact count", () => {
    const without = sources.filter((s) => s.file !== "components/ModalShell.tsx");
    expect(checkStacking(without, HOST_ID).overlays).toHaveLength(EXPECTED_OVERLAYS - 1);
  });

  it("5. a portal named only in a comment, or aimed at the body, does not count as the toast's", () => {
    expect(portalsInto("// createPortal(x, document.getElementById(TOAST_HOST_ID))\nconst a = 1;", "TOAST_HOST_ID")).toBe(false);
    expect(portalsInto("createPortal(x, document.body);", "TOAST_HOST_ID")).toBe(false);
    expect(portalsInto("const h = document.getElementById(TOAST_HOST_ID); createPortal(x, h);", "TOAST_HOST_ID")).toBe(true);
  });
});
