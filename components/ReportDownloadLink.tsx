import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

type ReportDownloadLinkProps = {
  href: string;
  label: string;
};

/**
 * A PDF report is generated server-side and downloaded via a plain link —
 * never `window.print()`, which only ever captured whatever happened to be
 * mounted in the DOM at the time. That broke the day the dashboard's
 * sections started arriving collapsed: components/CollapsibleSection.tsx
 * renders `{open && children}`, so a closed section isn't mounted at all,
 * and printing the page would have produced a blank report.
 *
 * A plain server-renderable `<a>`, same pattern already used by
 * app/.../reserves/page.tsx's own "Exporter en PDF" link — no client-side
 * state needed, so no 'use client' here either.
 */
export default function ReportDownloadLink({ href, label }: ReportDownloadLinkProps) {
  return (
    <a
      href={href}
      className="print:hidden inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600"
    >
      <ArrowDownTrayIcon className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
