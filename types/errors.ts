export type error = {
    type: "error" | "zodError";
    message: string | Record<string, string>;
}

export type ServerError = error;