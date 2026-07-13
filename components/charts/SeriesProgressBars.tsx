'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";

type SeriesProgressBarsProps = {
  items: { id: number | string; name: string; done: number; total: number; percent: number }[];
};

const BAR_COLOR = "#3b82f6";
const HEIGHT_PER_ROW = 36;

export default function SeriesProgressBars({ items }: SeriesProgressBarsProps) {
  const data = items.map((g) => ({ name: g.name, percent: g.percent, label: `${g.done}/${g.total}` }));
  const height = Math.max(HEIGHT_PER_ROW * data.length, HEIGHT_PER_ROW);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(_, __, item) => [item.payload.label, null]} />
        <Bar dataKey="percent" radius={[4, 4, 4, 4]} barSize={16}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={BAR_COLOR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
