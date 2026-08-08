import { MAX_SCAN_STRING_LENGTH } from "@/schemas/deliveryNoteScan";

// Deliberately dependency-light: no sharp, no @anthropic-ai/sdk, no openai —
// unlike lib/deliveryNoteScan.ts, which imports all three at module scope and
// is therefore unusable from client code. This module exists so a client
// component (components/ScanDeliveryNoteModal.tsx) can compute EXACTLY the
// name the server will store for a preview, instead of reimplementing its own
// (and inevitably drifting) version of the same rule — the modal used to do
// exactly that: `${brand}${brand && reference ? " - " : ""}${reference}` with
// no trim, no control/bidi stripping and no length bound, so what the admin
// previewed on screen was already not what the server was about to persist.

// Control characters (U+0000-U+001F, U+007F) and the Unicode bidi override/
// isolate marks (U+202A-U+202E, U+2066-U+2069) a scanned string could carry
// - e.g. a right-to-left override that flips how a name renders. Stripped
// here, server-side, rather than relying on a review UI's CSS `truncate`:
// that only clips overflow visually, it doesn't remove the characters from
// what's actually sent to the client and rendered in the DOM.
const CONTROL_AND_BIDI_CHARS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

/** Strips control/bidi characters and re-bounds to MAX_SCAN_STRING_LENGTH — a real truncation of the returned value, not a cosmetic one. */
export function sanitizeScannedString(value: string): string {
    return value.replace(CONTROL_AND_BIDI_CHARS, "").trim().slice(0, MAX_SCAN_STRING_LENGTH);
}

/** Same as sanitizeScannedString, but for an optional/nullable field (brand, reference, supplier): non-string input and a value that sanitizes down to "" both become null, never an empty string. */
export function sanitizeScannedNullableString(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const cleaned = sanitizeScannedString(value);
    return cleaned === "" ? null : cleaned;
}

/**
 * Composes ProjectMaterial.name from a scanned item's brand and/or
 * reference. ProjectMaterial.name is NOT NULL in the database, but the scan
 * flow never asks the model (or, on apply, trusts the client) for a
 * free-text product name — so this composed string is the only source of
 * that name for a scan-created material:
 *  - brand + reference -> "<brand> — <reference>"
 *  - brand only        -> "<brand>"
 *  - reference only     -> "<reference>"
 *  - neither            -> "" — callers creating a new material must reject
 *    this case themselves rather than persist it: schemas/deliveryNoteScan.ts's
 *    scannedItemSchema `.refine()` only tests brand/reference's raw
 *    truthiness (a whitespace-only brand passes it), so
 *    actions/deliveryNoteScan/deliveryNoteScan.ts additionally checks the
 *    COMPOSED name after calling this function, before writing anything. A
 *    plain "" is returned here rather than throwing, since a merge row (an
 *    existing materialId set) legitimately has no brand/reference of its own
 *    and its composed name is simply unused in that case.
 *
 * Expects already-sanitized (sanitizeScannedNullableString) brand/reference:
 * this only re-bounds the JOINED string to MAX_SCAN_STRING_LENGTH, since two
 * individually-bounded strings can still overflow once concatenated with
 * the separator.
 */
export function composeMaterialName(brand: string | null, reference: string | null): string {
    const composed = brand && reference ? `${brand} — ${reference}` : brand || reference || "";
    return sanitizeScannedString(composed);
}
