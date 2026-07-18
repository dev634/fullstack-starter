"use client";

import { useTranslation } from "@/components/LocaleProvider";

const STATUS_CLASSES: Record<string, string> = {
  PLANIFIEE: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  FAITE: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
  ANNULEE: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
};

export default function InterventionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = STATUS_CLASSES[status] ?? STATUS_CLASSES.PLANIFIEE;
  const label = t.interventions.status[status as keyof typeof t.interventions.status] ?? t.interventions.status.PLANIFIEE;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
