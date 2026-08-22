import type { Dictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

export function formDataToObject(formData: FormData): Record<string, string | number> {
    const obj: Record<string, string | number> = {};
    for (const [key, value] of formData.entries()) {
        // Skip React Server Action internal fields ($ACTION_REF_1, $ACTION_KEY, ...)
        // that get injected into the submitted FormData.
        if (key.startsWith("$")) continue;
        if (typeof value === "string") {
            obj[key] = value;
        }
    }
    return obj;
}

export function deleteFormDataEntries(formData: FormData, keys: string[]) {
    keys.forEach(key => {
        formData.delete(key);
    });
}

// Stable codes an app-thrown `{ type: "error", message, i18n }` error can
// carry so getErrorMessage renders a translated message instead of the
// English string set as its `.message` fallback at the throw site
// (lib/cloudinary.ts's 17 upload-validation throws — fix/blocked-legitimate-
// input, point 3) — the same stable-code convention already used for a zod
// `.refine()`'s params.i18n (lib/i18n/zodErrors.ts).
const UPLOAD_ERROR_CODES = [
    "uploadTooLarge",
    "uploadNotImage",
    "uploadTypeNotAllowed",
    "uploadNotPdf",
    "uploadFailed",
] as const;
type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

function isUploadErrorCode(code: unknown): code is UploadErrorCode {
    return typeof code === "string" && (UPLOAD_ERROR_CODES as readonly string[]).includes(code);
}

export function getErrorMessage(error: unknown, fallback: string, t?: Dictionary): string {
    // Repository functions throw `{ type: "repositoryError", message: "..." }`
    // on an unexpected DB failure — an internal, English-only diagnostic
    // string (already console.log'd by the repository itself, right before
    // throwing), never meant to reach the end user. It used to share the
    // exact same shape as this app's own pre-localized errors (e.g.
    // `throw { type: "error", message: t.materials.messages.invalidId }`,
    // thrown from the action layer with an already-translated message) —
    // both got relayed verbatim below, which is how "Database Error creating
    // material." ended up straight in a French UI. Always use the caller's
    // own (already localized) fallback for this one type instead.
    if (error && typeof error === "object" && "type" in error && (error as { type: unknown }).type === "repositoryError") {
        return fallback;
    }
    // An upload-validation error (lib/cloudinary.ts) carries a stable `i18n`
    // code alongside its English `.message` — translated here, the same way
    // a repository's raw diagnostic is replaced above, when the caller
    // passes the active dictionary. Without `t` (a caller that hasn't been
    // updated, or a test asserting the raw schema-declared message) this
    // falls through to the English `.message` below, unchanged.
    if (t && error && typeof error === "object" && "i18n" in error) {
        const code = (error as { i18n?: unknown }).i18n;
        if (isUploadErrorCode(code)) {
            const params =
                "i18nParams" in error
                    ? (error as { i18nParams?: Record<string, string | number> }).i18nParams
                    : undefined;
            return params ? format(t.errors[code], params) : t.errors[code];
        }
    }
    return error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : fallback;
}