// Route-level skeleton for the Files section's own page. Without this file
// the segment would inherit
// app/clients/[id]/projects/[projectId]/loading.tsx one level up — a
// header-card-plus-generic-sections shape that has nothing to do with this
// page's title row + single browsable-list card (breadcrumb, folder/file
// rows, upload form).
export default function ProjectFilesLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        {/* Title row: heading · project name, and the back-to-project link */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-7 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          {/* Header: section title + "new folder" button */}
          <div className="flex items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <div className="h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Breadcrumb */}
          <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-2.5 sm:px-6">
            <div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Folder/file rows */}
          <div className="divide-y divide-gray-300 dark:divide-gray-700">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
                <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>

          {/* Upload form */}
          <div className="border-t border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <div className="h-9 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </main>
  );
}
