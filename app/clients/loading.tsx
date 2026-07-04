export default function ClientsLoading() {
  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="h-9 w-40 animate-pulse rounded bg-white dark:bg-gray-800" />
          <div className="h-10 w-28 animate-pulse rounded bg-white dark:bg-gray-800" />
        </div>
        <div className="h-10 w-full animate-pulse rounded bg-white dark:bg-gray-800" />
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-gray-100 dark:bg-gray-700" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
