import z from "zod";

export function makeObjectFromZodError(error: z.ZodError): Record<string, string> {
    const errorObject: Record<string, string> = {};
    error.issues.forEach((err) => {
        if (err.path.length > 0) {
            const fieldName = err.path[0] as string;
            errorObject[fieldName] = err.message;
        }
    });
    return errorObject;
}