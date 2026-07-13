'use client'
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useTranslation } from "@/components/LocaleProvider";

type MaterialStockDonutProps = {
  green: number;
  orange: number;
  red: number;
};

const COLORS = { green: "#22c55e", orange: "#f59e0b", red: "#ef4444" };

export default function MaterialStockDonut({ green, orange, red }: MaterialStockDonutProps) {
  const { t } = useTranslation();
  const total = green + orange + red;
  const data = [
    { key: "green" as const, name: t.materials.stockStatus.green, value: green },
    { key: "orange" as const, name: t.materials.stockStatus.orange, value: orange },
    { key: "red" as const, name: t.materials.stockStatus.red, value: red },
  ];

  return (
    <div className="relative flex flex-col items-center">
      <PieChart width={200} height={200}>
        <Pie
          data={data}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius={65}
          outerRadius={90}
          startAngle={90}
          endAngle={-270}
          paddingAngle={total > 0 ? 2 : 0}
        >
          {data.map((entry) => (
            <Cell key={entry.key} fill={COLORS[entry.key]} stroke="none" />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-gray-900 dark:text-gray-100">
        <span className="text-2xl font-semibold">{total}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {data.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[entry.key] }} />
            {entry.name} ({entry.value})
          </span>
        ))}
      </div>
    </div>
  );
}
