import z from "zod";

// Shared bounds between the model's raw tool-call output (validated in
// lib/deliveryNoteScan.ts, on both the Anthropic and OpenAI paths) and the
// admin-reviewed items submitted here: both describe the same row shape, and
// both are external input arriving over the network — an LLM response in one
// case, a client-supplied form field in the other — so both must reject the
// same abuse.
// - MAX_SCAN_ITEMS: bounds `applyScanItems` (repository/projectMaterials.ts)
//   to a single Prisma transaction of a realistic size. A genuine delivery
//   note rarely carries more than a few dozen lines; 200 is generous
//   headroom, far under the ~10k rows that would turn a scan submission into
//   a transaction-abuse vector.
// - MAX_SCAN_STRING_LENGTH: no real product name/unit/reference/supplier on
//   a delivery note runs anywhere near this; it bounds both storage and what
//   gets echoed back to the reviewing admin's screen.
// - MAX_SCAN_QUANTITY: a defensive ceiling, not a business one — no real
//   delivery line is anywhere near a million units. It exists because
//   `quantity` feeds a Prisma `Float` column via `increment`
//   (repository/projectMaterials.ts::applyScanItems/createOrAccumulate), and
//   an unbounded value (up to ~1.8e308 today) can saturate/overflow it.
export const MAX_SCAN_ITEMS = 200;
export const MAX_SCAN_STRING_LENGTH = 200;
export const MAX_SCAN_QUANTITY = 1_000_000;

// One reviewed line item from the scan: materialId set means "add this
// quantity to an existing material's stock", absent/null means "create a
// new material with this name and quantity" — mirrors the picker convention
// used elsewhere (e.g. schemas/projectMaterial.ts's link field).
const scannedItemSchema = z.object({
    name: z.string().min(1).max(MAX_SCAN_STRING_LENGTH),
    quantity: z.coerce.number().positive().max(MAX_SCAN_QUANTITY),
    unit: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    reference: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    materialId: z.coerce.number().int().positive().nullable().optional(),
});

// Submitted as a single JSON-encoded hidden field — a native FormData can't
// carry an array of edited rows any other way (same constraint the "link"
// picker in projectMaterial.ts works around by encoding into one field).
const itemsJson = z.string().transform((value, ctx) => {
    try {
        const parsed = JSON.parse(value);
        return z.array(scannedItemSchema).min(1).max(MAX_SCAN_ITEMS).parse(parsed);
    } catch {
        ctx.addIssue({ code: "custom", message: "Invalid items" });
        return z.NEVER;
    }
});

export const applyDeliveryScanSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    // Note-level supplier (one per bulletin), applied to every new material.
    supplier: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    items: itemsJson,
    // clientId is intentionally NOT accepted here: it used to be read
    // straight off the form and trusted for `revalidatePath`, without ever
    // being checked against `projectId`. The action now resolves it from the
    // database via the already project-scope-checked projectId instead — see
    // actions/deliveryNoteScan/deliveryNoteScan.ts.
});

export type ApplyDeliveryScanInput = z.infer<typeof applyDeliveryScanSchema>;

// --- Model output (lib/deliveryNoteScan.ts) ---
// The vision model's tool-call response is external input arriving over the
// network like any other — validated here on both the Anthropic and OpenAI
// paths, instead of trusted via a type assertion.
const scannedModelItemSchema = z.object({
    name: z.string().min(1).max(MAX_SCAN_STRING_LENGTH),
    quantity: z.coerce.number().positive().max(MAX_SCAN_QUANTITY),
    unit: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    reference: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
});

export const scannedDeliveryNoteSchema = z.object({
    supplier: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    // Absent from the tool call (the model found no line items) is treated
    // the same as an empty array — extractDeliveryNoteItems raises its own
    // "could not read any items" error either way.
    items: z.array(scannedModelItemSchema).max(MAX_SCAN_ITEMS).default([]),
});

export type ScannedModelOutput = z.infer<typeof scannedDeliveryNoteSchema>;
