'use client'
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useTranslation } from "@/components/LocaleProvider";
import {
  CATEGORICAL_COLORS,
  CATEGORICAL_OTHER_COLOR,
  CATEGORICAL_DOT_CLASSES,
  CATEGORICAL_OTHER_DOT_CLASS,
  PROGRESS_REMAINING_COLOR,
  PROGRESS_REMAINING_DOT_CLASS,
} from "@/lib/chartColors";

// A 9th+ item never gets a generated hue — it folds into a single "Other"
// slice instead, keeping the fixed 8-color order meaningful (see the
// dataviz skill's categorical-palette rule).
const MAX_NAMED_SLICES = CATEGORICAL_COLORS.length;

export type TaskProgressDonutItem = {
  id: number | string;
  name: string;
  done: number;
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
  const folded = overflow ? weighted.slice(MAX_NAMED_SLICES - 1) : [];
  const other = folded.length
    ? { done: folded.reduce((sum, item) => sum + item.done, 0), total: folded.reduce((sum, item) => sum + item.total, 0) }
    : null;

  const legendEntries = [
    ...shown.map((item, index) => ({
      name: item.name,
      percent: item.percent,
      color: CATEGORICAL_COLORS[index],
      dotClass: CATEGORICAL_DOT_CLASSES[index],
    })),
    ...(other
      ? [
          {
            name: t.projectDashboard.legend.other,
            percent: other.total > 0 ? Math.round((other.done / other.total) * 100) : 0,
            color: CATEGORICAL_OTHER_COLOR,
            dotClass: CATEGORICAL_OTHER_DOT_CLASS,
          },
        ]
      : []),
  ];

  // Each task/series gets two arcs back to back — its own color for the
  // done portion, plain grey for what's left — so a slice's own color only
  // ever covers what's actually finished, not its full weight.
  const namedEntries = other ? [...shown, { name: t.projectDashboard.legend.other, done: other.done, total: other.total }] : shown;
  const slices = namedEntries.flatMap((item, index) => {
    const color = index < legendEntries.length ? legendEntries[index].color : CATEGORICAL_OTHER_COLOR;
    const remaining = item.total - item.done;
    return [
      { key: `${item.name}-done`, name: item.name, value: item.done, color },
      { key: `${item.name}-remaining`, name: item.name, value: remaining, color: PROGRESS_REMAINING_COLOR },
    ];
  });

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
          paddingAngle={slices.length > 1 ? 1 : 0}
        >
          {slices.map((slice) => (
            <Cell key={slice.key} fill={slice.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip />
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
        {legendEntries.map((entry) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${entry.dotClass}`} />
            {entry.name}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROGRESS_REMAINING_DOT_CLASS}`} />
          {t.projectDashboard.legend.remaining}
        </li>
      </ul>
    </div>
  );
}
