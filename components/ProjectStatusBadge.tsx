const STATUS_MAP: Record<string, { label: string; className: string }> = {
  ETUDE: {
    label: "Étude",
    className: "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
  },
  SIGNE: {
    label: "Signé",
    className: "border-purple-300 bg-purple-100 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300",
  },
  EN_COURS: {
    label: "En cours",
    className: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  },
  RACCORDEMENT: {
    label: "Raccordement",
    className: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  },
  TERMINE: {
    label: "Terminé",
    className: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
  },
  ANNULE: {
    label: "Annulé",
    className: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
  },
};

export default function ProjectStatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.ETUDE;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
