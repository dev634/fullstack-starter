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
    // lib/imageMetadata.ts's queue is full (imageBusy): a photo upload is
    // refused at once, without ever sending the original.
    "uploadBusy",
    // The other refusals of lib/imageMetadata.ts's decode (lib/cloudinary.ts::
    // uploadErrorFromDecode): the account already has an image in progress, or is out
    // of decode time ({minutes} from i18nParams), the decoder is down, the output or the
    // pixel count is beyond what the storage takes ({max}).
    "imageInProgress",
    "imageQuota",
    "imageUnavailable",
    "imageOutputTooLarge",
    "imageTooManyPixels",
] as const;
type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

function isUploadErrorCode(code: unknown): code is UploadErrorCode {
    return typeof code === "string" && (UPLOAD_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * i18n codes thrown by a repository/lib layer OUTSIDE the upload-validation
 * family above, each resolved from its own place in the dictionary rather
 * than `t.errors` — repository/equipmentLoans.ts::create throws this one for
 * the "already lent" unique-constraint conflict, whose user-facing message
 * already lives under `t.loans.messages`, not `t.errors`.
 */
const OTHER_I18N_RESOLVERS: Record<string, (t: Dictionary) => string> = {
    alreadyLent: (t) => t.loans.messages.alreadyLent,
    // lib/cloudinary.ts::uploadEquipmentPhoto refuses HEIC/AVIF/BMP/TIFF
    // (decision B, rejected after a live proof — see that function's doc)
    // with a message naming the accepted formats, not the generic
    // "must be an image file" the upload codes above use.
    equipmentPhotoUnsupportedFormat: (t) => t.equipment.messages.unsupportedPhotoFormat,
    // repository/clients.ts (create AND update) throws this on the unique
    // index on Client.email; the importer and both forms show the same string.
    duplicateClientEmail: (t) => t.clients.messages.duplicateEmail,
};

/**
 * The shapes this application throws ITSELF and whose `.message` is written
 * for the user, a CLOSED set: `{ type: "error", message }` (the application's
 * own refusal), `{ type: "zodError", message, fieldsForm }` (the
 * services' validation) and `{ type: "databaseError", message, i18n }`
 * (repository/clients.ts's duplicate e-mail, translated by its `i18n` code before
 * it gets here). The other types the application throws never reach this line:
 * `repositoryError` is answered by the fallback first (above), `duplicate`
 * (repository/jobFunctions.ts, projectWorkers.ts, users.ts: English text) is caught
 * and translated by its four actions, and `unmatchedScanMaterial` and
 * `guardRefused` carry no `message` at all. A type outside the set is the
 * fallback, not its English message. A native `Error` is never one of them,
 * whatever its `type` property: its message comes from a library or from a bug (the
 * Cloudinary SDK's "Must supply api_key", a Prisma message) and is for the
 * logs, not for the screen.
 */
const RELAYED_ERROR_TYPES: readonly string[] = ["error", "zodError", "databaseError"];

function isAppError(error: unknown): error is { type: string; message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        !(error instanceof Error) &&
        "type" in error &&
        typeof error.type === "string" &&
        RELAYED_ERROR_TYPES.includes(error.type) &&
        "message" in error &&
        typeof error.message === "string"
    );
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
    // A native Error (the SDK's, Prisma's, a TypeError from a bug) never
    // reaches the screen: the caller's own fallback, and the cause in the logs.
    if (error instanceof Error) {
        console.error("getErrorMessage: native error replaced by the generic message:", error);
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
        // Object.hasOwn, not `in`: `in` walks the prototype chain, so a code
        // of "toString" or "constructor" would resolve to Object.prototype's
        // members instead of a dictionary string (delta audit, Low).
        if (typeof code === "string" && Object.hasOwn(OTHER_I18N_RESOLVERS, code)) {
            return OTHER_I18N_RESOLVERS[code](t);
        }
    }
    if (isAppError(error)) return error.message;
    // Anything else (an object without `type`, a string, undefined) is not
    // ours either: the fallback, and the cause in the logs.
    console.error("getErrorMessage: unrecognised error replaced by the generic message:", error);
    return fallback;
}