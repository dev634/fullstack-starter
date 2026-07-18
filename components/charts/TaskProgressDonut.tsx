'use client'
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useTranslation } from "@/components/LocaleProvider";
import {
  CATEGORICAL_COLORS,
  CATEGORICAL_OTHER_COLOR,
  CATEGORICAL_DOT_CLASSES,
  CATEGORICAL_OTHER_DOT_CLASS,
} from "@/lib/chartColors";

// A 9th+ item never gets a generated hue — it folds into a single "Other"
// slice instead, keeping the fixed 8-color order meaningful (see the
// dataviz skill's categorical-palette rule).
const MAX_NAMED_SLICES = CATEGORICAL_COLORS.length;

export type TaskProgressDonutItem = {
  id: number | string;
  name: string;
  total: number;
  percent: number;
};

type TaskProgressDonutProps = {
  items: TaskProgressDonutItem[];
  done: number;
  total: number;
  percent: number;
};

export default function TaskProgressDonut({ items, done, total, percent }: TaskProgressDonutProps) {
  const { t } = useTranslation();

  const weighted = items.filter((item) => item.total > 0);
  const overflow = weighted.length > MAX_NAMED_SLICES;
  const shown = overflow ? weighted.slice(0, MAX_NAMED_SLICES - 1) : weighted;
  const otherTotal = overflow
    ? weighted.slice(MAX_NAMED_SLICES - 1).reduce((sum, item) => sum + item.total, 0)
    : 0;

  const slices = [
    ...shown.map((item, index) => ({
      name: item.name,
      value: item.total,
      percent: item.percent,
      color: CATEGORICAL_COLORS[index],
      dotClass: CATEGORICAL_DOT_CLASSES[index],
    })),
    ...(overflow
      ? [
          {
            name: t.projectDashboard.legend.other,
            value: otherTotal,
            percent: null,
            color: CATEGORICAL_OTHER_COLOR,
            dotClass: CATEGORICAL_OTHER_DOT_CLASS,
          },
        ]
      : []),
  ];

  return (
    <div className="relative flex flex-col items-center">
      <PieChart width={200} height={200}>
        <Pie
          data={slices}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius={65}
          outerRadius={90}
          startAngle={90}
          endAngle={-270}
          paddingAngle={slices.length > 1 ? 2 : 0}
        >
          {slices.map((slice) => (
            <Cell key={slice.name} fill={slice.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip formatter={(value, name, item) => [`${item.payload.percent ?? "—"}%`, name]} />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-gray-900 dark:text-gray-100">
        <span className="text-2xl font-semibold">{percent}%</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {done}/{total}
        </span>
      </div>
      {/* Direct labels alongside every color dot — the palette has slices
          under the 3:1 contrast floor, so identity can't rely on color alone. */}
      <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slice.dotClass}`} />
            {slice.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
