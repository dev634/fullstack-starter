/**
 * Count page objects in a raw PDF buffer ("/Type /Pages" is the tree, not a
 * page) — shared by every PDF report's test suite (réserves, dashboard),
 * extracted from tests/reserves-report.test.ts so a second report's tests
 * don't redefine the same regex.
 */
export function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}
