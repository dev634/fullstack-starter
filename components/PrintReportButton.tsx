'use client'
import { PrinterIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";

export default function PrintReportButton() {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
    >
      <PrinterIcon className="h-3.5 w-3.5" />
      {t.projectDashboard.generateReport}
    </button>
  );
}
