export default function ClientDetailLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-xl mx-auto overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-4 py-5 sm:px-6">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-gray-100 dark:bg-gray-700" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
          </div>
        </div>
        <div className="px-4 py-2 sm:px-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-4 last:border-b-0">
              <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              <div className="h-4 flex-1 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
            </div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-4 sm:px-6">
          <div className="h-9 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
          <div className="h-9 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
        </div>
      </div>
    </main>
  );
}
