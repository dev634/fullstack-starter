"use client";

import { useTranslation } from "@/components/LocaleProvider";

const STATUS_CLASSES: Record<string, string> = {
  PROSPECT: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  CLIENT: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
  INACTIVE: "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
};

export default function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = STATUS_CLASSES[status] ?? STATUS_CLASSES.PROSPECT;
  const label = t.clients.status[status as keyof typeof t.clients.status] ?? t.clients.status.PROSPECT;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
