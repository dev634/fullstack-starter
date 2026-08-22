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
        if (i18nCode === "requiredQuantityMissing") return t.errors.requiredQuantityMissing;
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
        // fix/blocked-legitimate-input, point 3: a number's too_small (e.g.
        // ProjectMaterial.quantity's .nonnegative(), minimum 0) used to fall
        // all the way through to "Ce champ est requis." for a value like -5 —
        // a lie, the field wasn't empty, it was out of range. minLength above
        // only handles origin "string" on purpose (a min of 1 there usually
        // does mean "required"); a number's min is a real business bound.
        if (issue.origin === "number") {
            return format(t.errors.minValue, { min: minimum });
        }
        return t.errors.required;
    }

    // adversarial pass 2, point 5: every new .max() added to a string field
    // needs a message more specific than the generic fallback below, the
    // same way too_small already gets one for .min().
    if (issue.code === "too_big" && issue.origin === "string") {
        const maximum = "maximum" in issue ? Number(issue.maximum) : undefined;
        if (maximum !== undefined) {
            return format(t.errors.maxLength, { max: maximum });
        }
    }

    // fix/blocked-legitimate-input, point 3: same gap as too_small above — a
    // number's too_big (e.g. ProjectMaterial.quantity's .max(MAX_SCAN_QUANTITY))
    // fell through to the generic "Champ invalide." instead of saying what the
    // actual ceiling was.
    if (issue.code === "too_big" && issue.origin === "number") {
        const maximum = "maximum" in issue ? Number(issue.maximum) : undefined;
        if (maximum !== undefined) {
            return format(t.errors.maxValue, { max: maximum });
        }
    }

    if (issue.code === "invalid_type") {
        return t.errors.required;
    }

    if (issue.code === "invalid_value") {
        return t.errors.invalidValue;
    }

    return t.errors.invalid;
}
