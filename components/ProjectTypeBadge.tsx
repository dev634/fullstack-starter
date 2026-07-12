const TYPE_MAP: Record<string, { label: string; className: string }> = {
  CENTRALE_AU_SOL: {
    label: "Centrale au sol",
    className: "border-teal-300 bg-teal-100 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300",
  },
  OMBRIERE: {
    label: "Ombrière",
    className: "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  TOITURE: {
    label: "Toiture",
    className: "border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300",
  },
  AUTRE: {
    label: "Autre",
    className: "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
  },
};

export default function ProjectTypeBadge({ type }: { type: string }) {
  const t = TYPE_MAP[type] ?? TYPE_MAP.AUTRE;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${t.className}`}
    >
      {t.label}
    </span>
  );
}
