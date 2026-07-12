import z from "zod";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { translateZodIssue } from "@/lib/i18n/zodErrors";

/**
 * Maps each invalid field to its first error message. Pass the active
 * dictionary to localize the message (derived from the issue's structural
 * `code`, not the schema's English `.message`); omitting it falls back to
 * the schema's raw message, e.g. for tests that don't care about locale.
 */
export function makeObjectFromZodError(error: z.ZodError, t?: Dictionary): Record<string, string> {
    const errorObject: Record<string, string> = {};
    error.issues.forEach((issue) => {
        if (issue.path.length > 0) {
            const fieldName = issue.path[0] as string;
            errorObject[fieldName] = t ? translateZodIssue(issue, t) : issue.message;
        }
    });
    return errorObject;
}
