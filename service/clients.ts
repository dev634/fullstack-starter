import { makeObjectFromZodError } from "@/lib/zod";
import { create } from "@/repository/clients";
import { CreateClientInput, createClientSchema } from "@/schemas/client";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";


export async function createClient(data: CreateClientInput & { photoUrl?: string | null }) {
    const t = getDictionary(await getLocale());
    try {
        const parsedData = createClientSchema.safeParse(data);

        if (!parsedData.success) {
            throw {
                type: "zodError",
                message: t.errors.validationError,
                fieldsForm: makeObjectFromZodError(parsedData.error, t)
            };
        }

        const created = await create({
            ...parsedData.data,
            phone: parsedData.data.phone || null,
            website: parsedData.data.website || null,
            photoUrl: data.photoUrl ?? null,
        });
        return {
            type: "success",
            message: t.clients.messages.created,
            id: created.id,
        }

    } catch (error) {
        console.log(error)
        if (error && typeof error === "object" && "type" in error && (error.type === "zodError" || error.type === "databaseError")) {
            throw error;
        }

        throw {
            type: "error",
            message: t.errors.serverError
        }
    }
}
