import z from "zod";

// One reviewed line item from the scan: materialId set means "add this
// quantity to an existing material's stock", absent/null means "create a
// new material with this name and quantity" — mirrors the picker convention
// used elsewhere (e.g. schemas/projectMaterial.ts's link field).
const scannedItemSchema = z.object({
    name: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unit: z.string().nullable().optional(),
    materialId: z.coerce.number().int().positive().nullable().optional(),
});

// Submitted as a single JSON-encoded hidden field — a native FormData can't
// carry an array of edited rows any other way (same constraint the "link"
// picker in projectMaterial.ts works around by encoding into one field).
const itemsJson = z.string().transform((value, ctx) => {
    try {
        const parsed = JSON.parse(value);
        return z.array(scannedItemSchema).min(1).parse(parsed);
    } catch {
        ctx.addIssue({ code: "custom", message: "Invalid items" });
        return z.NEVER;
    }
});

export const applyDeliveryScanSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    items: itemsJson,
});

export type ApplyDeliveryScanInput = z.infer<typeof applyDeliveryScanSchema>;
