import { computeRingArc } from "@/lib/projectDashboard";
import { PROGRESS_DONE_COLOR, PROGRESS_REMAINING_COLOR } from "@/lib/chartColors";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type SeriesProgressRingsItem = { id: number | string; name: string; done: number; total: number; percent: number };

type SeriesProgressRingsProps = {
  items: SeriesProgressRingsItem[];
  t: Dictionary;
};

// viewBox units, not pixels — the actual on-screen size comes from the grid
// column width via `aspect-square w-full` below, so the ring scales down to
// fit 3 columns at 360px and back up on wider screens without ever
// overflowing its cell.
const VIEWBOX_SIZE = 100;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS = 42; // + half the stroke width stays inside the 50-unit half-viewBox
const STROKE_WIDTH = 8; // "un anneau fin"

/**
 * One thin "done/remaining" ring per category or ungrouped series, in a
 * responsive grid. Replaces SeriesProgressBars for the "Avancement par
 * catégorie / groupe" section only — the per-task detail section right
 * below it on the same dashboard keeps SeriesProgressBars (a shared bar
 * chart still compares magnitudes across many rows better than a grid of
 * rings would).
 *
 * Pure SVG, no client JS: a project can show a dozen of these, and none
 * needs interactivity, so this stays a Server Component — unlike
 * SeriesProgressBars, which is 'use client' only because recharts requires
 * it. `strokeDasharray`/`transform` below are SVG presentation attributes,
 * not the `style=""` HTML attribute the CSP (proxy.ts, no `unsafe-inline`
 * on style-src) can't authorize.
 *
 * Anti-pattern note, acknowledged rather than hidden: a two-slice
 * "done/remaining" ring is the textbook pie-chart anti-pattern, and a grid
 * of them compares worse across groups than one shared bar chart would (a
 * bar's length is directly comparable to its neighbour's; two circles of
 * the same size with different arc lengths are not, at a glance). The
 * percent written at the ring's center is what keeps each one individually
 * readable despite that — it's the remedy for the anti-pattern, not a fix
 * for the cross-group comparison, which is a real trade-off this owner
 * chose to accept for a compact grid.
 */
export default function SeriesProgressRings({ items, t }: SeriesProgressRingsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
      {items.map((item) => (
        <ProgressRing key={item.id} item={item} t={t} />
      ))}
    </div>
  );
}

function ProgressRing({ item, t }: { item: SeriesProgressRingsItem; t: Dictionary }) {
  const { doneLength, circumference } = computeRingArc(item.percent, RADIUS);
  // Rounded to a whole number for both the visual center label and the
  // accessible name, so the two never disagree — the exact value (with the
  // 2-decimal precision used elsewhere on this dashboard) is still
  // reachable via done/total, shown as plain text right below.
  const roundedPercent = Math.round(item.percent);
  const accessibleName = format(t.projectDashboard.groupProgressLabel, {
    name: item.name,
    percent: roundedPercent,
    done: item.done,
    total: item.total,
  });

  return (
    <div className="flex w-[5.5rem] min-w-0 flex-col items-center gap-1 text-center sm:w-24">
      <div className="relative aspect-square w-full max-w-20">
        <svg
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          role="img"
          aria-label={accessibleName}
          className="h-full w-full"
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={PROGRESS_REMAINING_COLOR}
            strokeWidth={STROKE_WIDTH}
          />
          {/* Omitted entirely at 0% rather than drawn with a 0-length dash:
              a rounded linecap on a zero-length dash still paints a small
              dot on some renderers, which would read as "barely started"
              instead of "not started". */}
          {item.percent > 0 && (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={PROGRESS_DONE_COLOR}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={`${doneLength} ${circumference}`}
              // Starts the arc at 12 o'clock instead of SVG's default
              // 3 o'clock, and draws it clockwise as percent grows.
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          )}
        </svg>
        {/* Decorative echo of the ring's own aria-label above — hidden from
            assistive tech so it isn't announced twice. The name and the
            done/total count below stay visible text, read normally. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-gray-900 dark:text-gray-100"
        >
          {roundedPercent}%
        </span>
      </div>
      <p className="w-full truncate text-xs font-medium text-gray-700 dark:text-gray-300" title={item.name}>
        {item.name}
      </p>
      {/* text-gray-600, not the text-gray-500 this dashboard uses elsewhere for
          a muted caption: on this card's light background (#f3f4f6) gray-500
          only reaches 4.39:1, just under the 4.5:1 AA floor for text this
          small — calculated, not eyeballed, per this component's own
          contrast check. gray-600 clears it (6.87:1) and dark mode's
          gray-400 was already compliant (5.78:1) so it's unchanged. */}
      <p className="text-[11px] text-gray-600 dark:text-gray-400">
        {item.done}/{item.total}
      </p>
    </div>
  );
}
