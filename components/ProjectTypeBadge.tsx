"use client";

import { useTranslation } from "@/components/LocaleProvider";

const TYPE_CLASSES: Record<string, string> = {
  CENTRALE_AU_SOL: "border-teal-300 bg-teal-100 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300",
  OMBRIERE: "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300",
  TOITURE: "border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300",
  AUTRE: "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
};

export default function ProjectTypeBadge({ type }: { type: string }) {
  const { t } = useTranslation();
  const className = TYPE_CLASSES[type] ?? TYPE_CLASSES.AUTRE;
  const label = t.projects.type[type as keyof typeof t.projects.type] ?? t.projects.type.AUTRE;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
