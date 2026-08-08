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
// - MAX_SCAN_STRING_LENGTH: no real product brand/reference/supplier on a
//   delivery note runs anywhere near this; it bounds both storage and what
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
// new material from brand/reference and quantity" — mirrors the picker
// convention used elsewhere (e.g. schemas/projectMaterial.ts's link field).
//
// `name` is intentionally NOT a field here: ProjectMaterial.name is composed
// server-side from brand + reference (composeMaterialName, in
// lib/materialName.ts), never trusted as a string the client sends —
// same reasoning as clientId below. brand and reference are each individually
// optional, but when materialId is absent (a new material is being created)
// at least one of the two must be present, enforced by the .refine() below
// rather than by making either field required outright: on a real delivery
// note sometimes the brand is missing, sometimes the reference is, and a
// hard requirement on one would just push whoever fills this in (today, an
// admin correcting a scan; earlier, the model itself) to invent the missing
// value instead of leaving it blank.
//
// This .refine() only tests brand/reference's RAW truthiness — a
// whitespace-only brand (" ") is truthy and passes it, even though it
// composes down to "" once sanitized. It stays here as a first, cheap
// rejection of the common case (both fields genuinely absent); the write
// path (actions/deliveryNoteScan/deliveryNoteScan.ts) additionally checks
// the COMPOSED name after sanitizing, which is what actually protects the
// write from a nameless material — see composeMaterialName's doc comment
// in lib/materialName.ts.
//
// Unlike scannedModelItemSchema below (the model's raw output), this is the
// schema for what gets WRITTEN to the database — so quantity stays
// `.positive()` here: a zero-quantity line is meaningless to actually apply
// to stock, even though the model is allowed to report one.
const scannedItemSchema = z
    .object({
        brand: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
        reference: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
        quantity: z.coerce.number().positive().max(MAX_SCAN_QUANTITY),
        materialId: z.coerce.number().int().positive().nullable().optional(),
    })
    .refine((item) => item.materialId != null || Boolean(item.brand) || Boolean(item.reference), {
        message: "A new material needs a brand or a reference.",
        path: ["brand"],
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
//
// Only brand, reference and quantity are requested from the model — no
// free-text `name` (composed server-side, see composeMaterialName in
// lib/materialName.ts) and no `unit` (dropped entirely from the scan
// flow; ProjectMaterial.unit stays editable by hand, see
// forms/EditMaterialForm.tsx). Fewer requested fields means fewer
// opportunities for the model to hallucinate a value that isn't really on
// the note.
//
// brand and reference are each individually optional (a real delivery note
// often shows only one of the two) — and, UNLIKE scannedItemSchema above,
// there is deliberately no `.refine()` requiring at least one of them here.
// This schema validates an entire ARRAY of items (see scannedDeliveryNoteSchema
// below); wrapping a per-item `.refine()` in `z.array(...)` makes Zod reject
// the WHOLE array the moment a single element fails it. The system prompt
// explicitly tells the model to OMIT brand/reference rather than invent one
// when a line is illegible or genuinely has neither (freight charges, a
// hand-written note, a worn label) — a real bulletin routinely has at least
// one such line, so this used to fail the entire scan ("photo illisible")
// over a single unremarkable row. Extraction instead DEGRADES: a line with
// neither field composes to an empty name and is filtered out downstream, in
// extractDeliveryNoteItems (lib/deliveryNoteScan.ts) — one row silently
// dropped, not the whole bulletin rejected. The write path
// (scannedItemSchema above, and the composed-name check in
// actions/deliveryNoteScan/deliveryNoteScan.ts) keeps enforcing "at least
// one of the two", since a create-a-material request MUST have a name.
//
// `quantity` is `.nonnegative()`, not `.positive()`, for the same reason: a
// reliquat line — an item back-ordered at zero delivered quantity — is
// common on a real bulletin, and a single such line must not fail the whole
// array either. A zero-quantity line is filtered out downstream alongside
// the empty-name case above; scannedItemSchema (the write path) keeps
// `.positive()`, since applying a delivery of zero to stock is meaningless.
const scannedModelItemSchema = z.object({
    brand: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    reference: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    quantity: z.coerce.number().nonnegative().max(MAX_SCAN_QUANTITY),
});

export const scannedDeliveryNoteSchema = z.object({
    supplier: z.string().max(MAX_SCAN_STRING_LENGTH).nullable().optional(),
    // Absent from the tool call (the model found no line items) is treated
    // the same as an empty array — extractDeliveryNoteItems raises its own
    // "could not read any items" error either way.
    items: z.array(scannedModelItemSchema).max(MAX_SCAN_ITEMS).default([]),
});

export type ScannedModelOutput = z.infer<typeof scannedDeliveryNoteSchema>;
