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
    return error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : fallback;
}