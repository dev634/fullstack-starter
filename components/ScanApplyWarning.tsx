// Partial success of a delivery-note apply: the materials ARE in stock, only the archive of the
// note was not saved. Distinct from an error (nothing to retry: applying again would double the
// stock) and from a silent success (the message must be read). `role="status"` announces it.
export function ScanApplyWarning({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded border border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-900 break-words dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100"
    >
      {message}
    </div>
  );
}
