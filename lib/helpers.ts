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

export function getErrorMessage(error: unknown, fallback: string): string {
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
    return error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : fallback;
}