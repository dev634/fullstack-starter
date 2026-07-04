const STATUS_MAP: Record<string, { label: string; className: string }> = {
  PROSPECT: { label: "Prospect", className: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  CLIENT: { label: "Client", className: "border-green-500/30 bg-green-500/15 text-green-300" },
  INACTIVE: { label: "Inactif", className: "border-gray-500/30 bg-gray-500/15 text-gray-300" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.PROSPECT;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
