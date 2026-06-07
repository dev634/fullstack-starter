import { createClientSchema } from "@/schemas/client";

export function formDataToObject(formData: FormData): Record<string, string | number> {
    const obj: Record<string, string | number> = {};
    for (const [key, value] of formData.entries()) {
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