/** Date -> "YYYY-MM-DDTHH:mm" in the browser's local time, for an <input type="datetime-local"> value. */
export function toDatetimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}`;
}

/**
 * "YYYY-MM-DDTHH:mm" (a datetime-local value, which carries the user's local
 * wall-clock time with NO zone) -> a full ISO-8601 instant string. The
 * conversion has to happen on the client, because only the browser knows the
 * user's timezone: `new Date("2026-08-01T09:30")` is interpreted in the
 * runtime's own zone, so parsing the bare string on a UTC server would store
 * a French user's 09:30 as 09:30 UTC (i.e. 11:30 Paris) instead of 07:30 UTC.
 * Sending an ISO instant makes the server's `new Date(...)` unambiguous.
 * Returns "" for empty/invalid input (the schema then flags the missing date).
 */
export function datetimeLocalToIso(local: string): string {
    if (!local) return "";
    const date = new Date(local);
    return isNaN(date.getTime()) ? "" : date.toISOString();
}
