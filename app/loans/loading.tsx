// Route-level skeleton for /loans — mirrors
// app/clients/[id]/projects/[projectId]/interventions/loading.tsx's shape
// (title row, one card with a header and a few rows), extended with the
// tab bar this page adds. Dimensions match the real content so there is no
// layout shift once the data resolves.
export default function LoansLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        {/* Title + subtitle */}
        <div className="flex flex-col gap-2">
          <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>

        {/* Tab bar: 4 equal cells */}
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] p-1 dark:bg-[#1f2937]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          {/* Header: section title + add button */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-9 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-300 dark:divide-gray-700">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-5 w-20 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
