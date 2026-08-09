import z from "zod";

// Shared bounds between the model's raw tool-call output (validated in
// lib/deliveryNoteScan.ts, on both the Anthropic and OpenAI paths) and the
// admin-reviewed items submitted here: both describe the same row shape, and
// both are external input arriving over the network — an LLM response in one
// case, a client-supplied form field in the other.
//
// The two paths ENFORCE these differently (adversarial pass 2, point 3): the
// write path below (scannedItemSchema, applyDeliveryScanSchema) still
// rejects outright on any of them, since it's a client-controlled submission
// the caller can simply resubmit corrected. The model-output path further
// down (scannedModelItemSchema, scannedDeliveryNoteSchema) instead DEGRADES —
// truncates a string, drops an over-quantity line, keeps only the first N
// items — because the alternative is failing an entire real bulletin
// ("photo illisible") over one line the model merely read a little too
// enthusiastically, forcing the admin to retry the whole scan from scratch.
// Same idea already applied there to a missing brand/reference and a
// zero-quantity line; see that schema's own comments for the detail.
// - MAX_SCAN_ITEMS: bounds `applyScanItems` (repository/projectMaterials.ts)
//   to a single Prisma transaction of a realistic size. A genuine delivery
//   note rarely carries more than a few dozen lines; 200 is generous
//   headroom, far under the ~10k rows that would turn a scan submission into
//   a transaction-abuse vector.
// - MAX_SCAN_STRING_LENGTH: no real product brand/reference/supplier on a
//   delivery note runs anywhere near this; it bounds both storage and what
//   gets echoed back to the reviewing admin's screen. Scan-only — unlike
//   MAX_SCAN_QUANTITY below, schemas/projectMaterial.ts does not import this
//   one; its own name-length bound comes from schemas/fields.ts instead.
// - MAX_SCAN_QUANTITY: a defensive ceiling, not a business one — no real
//   delivery line is anywhere near a million units. It exists because
//   `quantity` feeds a Prisma `Float` column via `increment`
//   (repository/projectMaterials.ts::applyScanItems/createOrAccumulate), and
//   an unbounded value (up to ~1.8e308 today) can saturate/overflow it. The
//   manual material-entry form feeds that exact same `increment` path (see
//   schemas/projectMaterial.ts's createMaterialSchema/updateMaterialSchema),
//   so it imports and reuses this same constant rather than duplicating the
//   number — adversarial pass 2, point 6.
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
//
// UNLIKE scannedItemSchema above (the write path, which stays hard-bounded),
// brand/reference/quantity are deliberately NOT bounded here (adversarial
// pass 2, point 3): this schema used to carry the same
// `.max(MAX_SCAN_STRING_LENGTH)` / `.max(MAX_SCAN_QUANTITY)` as the write
// path, and — same trap as the brand/reference-missing and zero-quantity
// cases documented above — wrapping either bound in `z.array(...)` rejected
// the WHOLE bulletin the moment a single line's model-read value merely ran
// long or high, undoing the very fix this file's other comments describe.
// Both bounds now degrade downstream instead, in extractDeliveryNoteItems
// (lib/deliveryNoteScan.ts): an over-length brand/reference/supplier is
// truncated by sanitizeScannedString (already called on every field there,
// via sanitizeScannedNullableString), and a line whose quantity exceeds
// MAX_SCAN_QUANTITY is dropped — the same treatment as a zero-quantity
// (reliquat) line, just above. `quantity` still has to actually coerce to a
// number: that's a structural-shape check (the model's tool call returning
// something that isn't a number at all), not a value-range one, so it's the
// one thing left that still fails the whole array — see this schema's
// module-level comment for that same distinction at the array level below.
const scannedModelItemSchema = z.object({
    brand: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    quantity: z.coerce.number().nonnegative(),
});

export const scannedDeliveryNoteSchema = z.object({
    // No `.max(MAX_SCAN_STRING_LENGTH)` here either — same reasoning as
    // brand/reference above; truncated downstream by
    // sanitizeScannedNullableString instead of failing the whole note.
    supplier: z.string().nullable().optional(),
    // Absent from the tool call (the model found no line items) is treated
    // the same as an empty array — extractDeliveryNoteItems raises its own
    // "could not read any items" error either way.
    //
    // MAX_SCAN_ITEMS is enforced by keeping only the first N items rather
    // than rejecting the whole note (adversarial pass 2, point 3): the
    // model's reply is already hard-capped by its own max_tokens (2048 —
    // see lib/deliveryNoteScan.ts), so a real response anywhere near 200
    // items is already pushing that budget; this is defense-in-depth against
    // a pathological response, not a bound a genuine bulletin should ever
    // brush against. Silently keeping the first N (in the model's own
    // emission order) rather than raising is consistent with every other
    // bound in this schema: a genuine outlier degrades instead of failing a
    // scan the admin would otherwise have to retry from scratch. The write
    // path (applyDeliveryScanSchema's itemsJson above) keeps rejecting an
    // oversized submission outright — that array is a client-controlled
    // review payload, not a bounded model response, so there is no
    // equivalent "already capped upstream" argument for it.
    items: z.array(scannedModelItemSchema).default([]).transform((items) => items.slice(0, MAX_SCAN_ITEMS)),
});

export type ScannedModelOutput = z.infer<typeof scannedDeliveryNoteSchema>;
