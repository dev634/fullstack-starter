// Route-level skeleton for the Tâches section's own page. Without this file
// the segment would inherit
// app/clients/[id]/projects/[projectId]/loading.tsx one level up — a
// header-card-plus-generic-sections shape that has nothing to do with this
// page's title row + single card (header, categories, task/série rows).
export default function ProjectTasksLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        {/* Title row: heading · project name, and the back-to-project link */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-7 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          {/* Header: section title + count, add-task/add-série/add-category buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="flex gap-2">
              <div className="h-8 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-8 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-8 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>

          {/* Task/série rows */}
          <div className="divide-y divide-gray-300 dark:divide-gray-700">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
                <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
