import type { z } from "zod";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import { MAX_SERIES_SIZE } from "@/schemas/task";

/**
 * Translates a single zod issue into a user-facing message, using the
 * issue's structural `code` (not its English `.message`) so the schema
 * definitions never need locale-awareness. Custom `.refine()` checks are
 * tagged with a stable `params.i18n` code (see schemas/auth.ts,
 * schemas/project.ts) since their `code` is always the generic "custom".
 */
export function translateZodIssue(issue: z.core.$ZodIssue, t: Dictionary): string {
    if (issue.code === "custom") {
        const i18nCode = (issue.params as { i18n?: string } | undefined)?.i18n;
        if (i18nCode === "passwordMismatch") return t.errors.passwordMismatch;
        if (i18nCode === "notANumber") return t.errors.notANumber;
        if (i18nCode === "patternMissingPlaceholder") return t.errors.patternMissingPlaceholder;
        if (i18nCode === "seriesRangeInvalid") return t.errors.seriesRangeInvalid;
        if (i18nCode === "seriesTooLarge") return format(t.errors.seriesTooLarge, { max: MAX_SERIES_SIZE });
        return issue.message;
    }

    if (issue.code === "invalid_format" && issue.format === "email") {
        return t.errors.invalidEmail;
    }

    if (issue.code === "too_small") {
        const minimum = "minimum" in issue ? Number(issue.minimum) : 1;
        if (issue.origin === "string" && minimum > 1) {
            return format(t.errors.minLength, { min: minimum });
        }
        return t.errors.required;
    }

    if (issue.code === "invalid_type") {
        return t.errors.required;
    }

    if (issue.code === "invalid_value") {
        return t.errors.invalidValue;
    }

    return t.errors.invalid;
}
