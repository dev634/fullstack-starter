'use client'
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useTranslation } from "@/components/LocaleProvider";
import { STOCK_HEX, STOCK_DOT_CLASSES, STOCK_STATUS_ORDER, type MaterialStockStatus } from "@/lib/materialStock";

type MaterialStockDonutProps = {
  materials: { id: number; name: string; status: MaterialStockStatus }[];
};

export default function MaterialStockDonut({ materials }: MaterialStockDonutProps) {
  const { t } = useTranslation();
  const total = materials.length;
  const counts = { green: 0, orange: 0, red: 0 };
  for (const m of materials) counts[m.status] += 1;

  // One slice per material (not per status) so same-status materials still
  // show up as visually separate wedges, with a gap between every slice.
  const slices = [...materials]
    .sort((a, b) => STOCK_STATUS_ORDER[a.status] - STOCK_STATUS_ORDER[b.status])
    .map((m) => ({ id: m.id, name: m.name, status: m.status, value: 1 }));

  return (
    <div className="relative flex flex-col items-center">
      <PieChart width={200} height={200}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={65}
          outerRadius={90}
          startAngle={90}
          endAngle={-270}
          paddingAngle={total > 1 ? 4 : 0}
        >
          {slices.map((entry) => (
            <Cell key={entry.id} fill={STOCK_HEX[entry.status]} stroke="none" />
          ))}
        </Pie>
        <Tooltip formatter={(_, __, item) => [t.materials.stockStatus[item.payload.status as MaterialStockStatus], item.payload.name]} />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-gray-900 dark:text-gray-100">
        <span className="text-2xl font-semibold">{total}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${STOCK_DOT_CLASSES.green}`} />
          {t.materials.stockStatus.green} ({counts.green})
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${STOCK_DOT_CLASSES.orange}`} />
          {t.materials.stockStatus.orange} ({counts.orange})
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${STOCK_DOT_CLASSES.red}`} />
          {t.materials.stockStatus.red} ({counts.red})
        </span>
      </div>
    </div>
  );
}
