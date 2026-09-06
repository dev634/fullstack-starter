// Route-level skeleton for the Personnel/Workforce section's own page.
// Without this file the segment would inherit
// app/clients/[id]/projects/[projectId]/loading.tsx one level up — a
// header-card-plus-generic-sections shape that has nothing to do with this
// page's title row + two cards (Sous-traitants, Intérimaires).
export default function ProjectWorkforceLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        {/* Title row: heading · project name, and the back-to-project link */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-7 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>

        {Array.from({ length: 2 }).map((_, cardIndex) => (
          <div
            key={cardIndex}
            className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm"
          >
            {/* Header: section title + count, add button */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-300 dark:divide-gray-700">
              {Array.from({ length: 3 }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
