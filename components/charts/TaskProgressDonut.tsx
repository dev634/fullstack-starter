'use client'
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useTranslation } from "@/components/LocaleProvider";
import {
  PROGRESS_DONE_COLOR,
  PROGRESS_REMAINING_COLOR,
  PROGRESS_DONE_DOT_CLASS,
  PROGRESS_REMAINING_DOT_CLASS,
} from "@/lib/chartColors";

type TaskProgressDonutProps = {
  done: number;
  total: number;
  percent: number;
};

export default function TaskProgressDonut({ done, total, percent }: TaskProgressDonutProps) {
  const { t } = useTranslation();
  const remaining = total - done;
  const data = [
    { name: t.projectDashboard.legend.done, value: done },
    { name: t.projectDashboard.legend.remaining, value: remaining },
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
          <Cell fill={PROGRESS_DONE_COLOR} stroke="none" />
          <Cell fill={PROGRESS_REMAINING_COLOR} stroke="none" />
        </Pie>
        <Tooltip />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-gray-900 dark:text-gray-100">
        <span className="text-2xl font-semibold">{percent}%</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {done}/{total}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${PROGRESS_DONE_DOT_CLASS}`} />
          {t.projectDashboard.legend.done}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${PROGRESS_REMAINING_DOT_CLASS}`} />
          {t.projectDashboard.legend.remaining}
        </span>
      </div>
    </div>
  );
}
