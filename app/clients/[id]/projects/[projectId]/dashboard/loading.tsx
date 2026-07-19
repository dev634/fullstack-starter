// Route-level skeleton for the project dashboard. Overrides the project-detail
// skeleton one level up so the donut-and-bars layout gets a matching shape
// instead of the detail page's header-and-sections placeholder.
export default function ProjectDashboardLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-7 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>

        {/* Task progress card: donut + category/detail bars */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-8 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="flex flex-col items-center gap-6 px-4 py-6 sm:px-6">
            <div className="h-40 w-40 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="w-full space-y-3 border-t border-gray-300 dark:border-gray-700 pt-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
