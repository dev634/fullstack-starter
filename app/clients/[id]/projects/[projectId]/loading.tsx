// Route-level skeleton for the project detail page (and its edit child).
// Placed here so the nested routes stop inheriting the client-detail-card
// skeleton from app/clients/[id]/loading.tsx, whose shape (a narrow centered
// card) is nothing like this full-width project layout.
export default function ProjectDetailLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        {/* Header card */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
          <div className="px-4 py-2 sm:px-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0"
              >
                <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-24 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
          <div className="flex gap-2.5 border-t border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-900 px-4 py-4 sm:px-6">
            <div className="h-9 w-24 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
            <div className="h-9 w-24 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
          </div>
        </div>

        {/* Collapsible section cards (dashboard summary, tasks, interventions…) */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm"
          >
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
