"use client";

import { useTranslation } from "@/components/LocaleProvider";

const STATUS_CLASSES: Record<string, string> = {
  ETUDE: "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
  SIGNE: "border-purple-300 bg-purple-100 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300",
  EN_COURS: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  RACCORDEMENT: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  TERMINE: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
  ANNULE: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
};

export default function ProjectStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = STATUS_CLASSES[status] ?? STATUS_CLASSES.ETUDE;
  const label = t.projects.status[status as keyof typeof t.projects.status] ?? t.projects.status.ETUDE;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
