"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/clientIp";
import {
  extractDeliveryNoteItems,
  prepareDeliveryNoteImage,
  readAndValidateDeliveryNoteImage,
  stripArchivedPhotoMetadata,
  scanProviderInfo,
  isScanError,
  scanErrorFromDecode,
  scanErrorMessage,
} from "@/lib/deliveryNoteScan";
import { composeMaterialName, sanitizeScannedNullableString } from "@/lib/materialName";
import { applyDeliveryScanSchema } from "@/schemas/deliveryNoteScan";
import { applyScanItems, findIdsInProject as findMaterialIdsInProject, isUnmatchedScanMaterialError } from "@/repository/projectMaterials";
import { isPublicIdReferenced as isFilePublicIdReferenced } from "@/repository/projectFiles";
import { isImageRefusal } from "@/lib/imageMetadata";
import { assetCompensation, writeWithCompensation } from "@/lib/uploadCompensation";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { findById as findProjectById } from "@/repository/projects";
import { archiveTooLargeMessage, STORAGE_IMAGE_LIMITS, uploadProjectFile } from "@/lib/cloudinary";
import { revalidateFiles } from "@/lib/revalidateFiles";
import { revalidateMaterials } from "@/lib/revalidateMaterials";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { DeliveryNoteScanActionState, ApplyDeliveryScanActionState } from "@/types/deliveryNoteScan";

// 20 scans/hour/user — generous for a real review workflow (an admin
// reconciling a batch of deliveries), tight enough to bound one account's
// worth of LLM spend if the credentials or the action itself are abused.
// This is the count actually allowed: the budget is checked BEFORE this
// attempt is reserved (see the ordering below), so the limit means exactly
// what it says — a prior version reserved first and only then checked with
// `count >= limit`, which made the request that tipped the count over the
// limit block ITSELF, so a limit of 20 only ever let 19 through.
const SCAN_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };
// 60 scans/hour/IP — covers a small team sharing one office connection while
// still bounding spend from a single source (spray protection, same idea as
// LOGIN_IP_LIMIT in lib/loginRateLimit.ts).
const SCAN_IP_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

type ScanLogOutcome = "success" | "error" | "rate_limited";

/**
 * Structured, content-free audit trail for the LLM call: who, which
 * provider/model, how much data, how long, what happened — deliberately
 * never the image bytes or the model's output. Without this, abuse (a
 * compromised account burning through the rate-limit budget, a provider
 * outage) is invisible, and there's no way to say afterwards which account's
 * photos went to which third party.
 */
function logScanEvent(fields: {
  userEmail: string;
  projectId: number | null;
  provider: string;
  model: string;
  bytes: number;
  // Size of the image actually sent to the model, after
  // lib/deliveryNoteScan.ts's reduceImageForModel resized/re-encoded it —
  // only known once extraction has succeeded, hence optional (absent on the
  // "error"/"rate_limited" outcomes below). Lets prod usage be checked
  // against `bytes` to see the real effect of the reduction, without ever
  // logging the image itself.
  bytesSent?: number;
  itemCount: number;
  durationMs: number;
  outcome: ScanLogOutcome;
}) {
  console.log("delivery_note_scan", fields);
}

/**
 * First step: read a delivery note photo and extract its line items — a
 * preview only, nothing is written to the database yet (see
 * applyDeliveryNoteScan for that), so the admin can review/correct the
 * scan before it touches stock.
 */
export async function scanDeliveryNote(
  prevState: DeliveryNoteScanActionState,
  formData: FormData
): Promise<DeliveryNoteScanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.materials.scan.chooseFile };
  }

  // Not sent by the client today (components/ScanDeliveryNoteModal.tsx only
  // submits `file`) — read defensively so the structured log below picks it
  // up automatically once that's wired through, without this action
  // depending on it for anything else.
  const rawProjectId = formData.get("projectId");
  const projectId =
    typeof rawProjectId === "string" && Number.isFinite(Number(rawProjectId)) ? Number(rawProjectId) : null;

  const ip = await getClientIp();
  const userKey = `scan:${roleCheck.email}`;
  const ipKey = `scan-ip:${ip}`;

  // Check the budget FIRST, read-only, THEN reserve the attempt — unlike
  // lib/authorizeCredentials.ts's login-attempt limiter (a security control,
  // where recording unconditionally before checking closes a race that
  // matters more than letting an already-blocked caller retry out of the
  // window), this is a business spend quota: a caller who's already blocked
  // and keeps retrying must NOT keep re-registering on every attempt, or the
  // sliding window never empties and they never unblock. The reservation
  // below still lands before the paid provider call, so a burst of
  // concurrent requests still can't all observe "under budget" before any of
  // them recorded — only this narrower, business-not-security window is left
  // open (same ordering already used by requestPasswordReset in
  // actions/auth/auth.ts, for the same reason).
  const [rl, rlIp] = await Promise.all([
    isRateLimited(userKey, SCAN_LIMIT),
    isRateLimited(ipKey, SCAN_IP_LIMIT),
  ]);
  if (rl.limited || rlIp.limited) {
    const { provider, model } = scanProviderInfo();
    logScanEvent({
      userEmail: roleCheck.email,
      projectId,
      provider,
      model,
      bytes: file.size,
      itemCount: 0,
      durationMs: 0,
      outcome: "rate_limited",
    });
    return {
      ...prevState,
      type: "error",
      // Reused rather than duplicated: same generic "too many attempts"
      // copy already used for login rate-limiting (lib/loginRateLimit.ts).
      message: format(t.auth.tooManyAttempts, {
        minutes: Math.ceil(Math.max(rl.retryAfterMs, rlIp.retryAfterMs) / 60000),
      }),
    };
  }

  const { provider, model } = scanProviderInfo();
  const startedAt = Date.now();

  try {
    // The decode of the image for the model comes BEFORE the unit of the quota is reserved: a refusal
    // of the decoder (an image already in progress, the account's decode budget, a busy queue, a decoder
    // that is down) is not a scan, and a double click must not cost one of the 20 units of the hour. The
    // account the role guard resolved (never a form field) owns the decode: one task at a time per
    // account, and a budget of decode time (lib/imageMetadata.ts).
    const prepared = await prepareDeliveryNoteImage(file, roleCheck.email);
    // The reservation still lands before the paid provider call.
    await Promise.all([registerFailure(userKey), registerFailure(ipKey)]);
    const { supplier, items, bytesSent } = await extractDeliveryNoteItems(prepared);
    logScanEvent({
      userEmail: roleCheck.email,
      projectId,
      provider,
      model,
      bytes: file.size,
      bytesSent,
      itemCount: items.length,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });
    return { ...prevState, type: "success", message: t.materials.scan.messages.scanned, items, supplier };
  } catch (error) {
    logScanEvent({
      userEmail: roleCheck.email,
      projectId,
      provider,
      model,
      bytes: file.size,
      itemCount: 0,
      durationMs: Date.now() - startedAt,
      outcome: "error",
    });
    if (isScanError(error)) {
      return { ...prevState, type: "error", message: scanErrorMessage(t, error) };
    }
    // Never relayed to the client: an Anthropic/OpenAI APIError can carry
    // the provider's HTTP status and raw response body.
    console.error("Delivery note scan: provider error", error);
    return { ...prevState, type: "error", message: t.errors.serverError };
  }
}

/**
 * Second step: apply the reviewed items — adds delivered quantity to an
 * existing material's stock (materialId set) or creates a new material
 * (materialId absent), then archives the photo (full resolution, metadata
 * stripped — see stripArchivedPhotoMetadata, lib/deliveryNoteScan.ts) to the
 * project's files, inside the "Bulletins de livraisons" folder when one
 * exists at the project root.
 */
export async function applyDeliveryNoteScan(
  prevState: ApplyDeliveryScanActionState,
  formData: FormData
): Promise<ApplyDeliveryScanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = applyDeliveryScanSchema.safeParse(raw);
  if (!parsed.success) {
    // Was `{ type: "zodError", message: ... }` with no fieldsForm — the only
    // action in the app that omitted it (adversarial pass 2, point 4): on a
    // batch of reviewed lines, one bad field said only "validation error",
    // never which. itemsJson's own transform (schemas/deliveryNoteScan.ts)
    // collapses every failure inside the JSON-encoded array — a malformed
    // JSON string, an over-length brand, a whitespace-only new-material row —
    // into a single issue on the "items" field, so fieldsForm.items is as
    // precise as this schema shape allows without restructuring it.
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  const { projectId, items } = parsed.data;
  const file = formData.get("file");

  // Each new material's name is composed from the SANITIZED brand/reference
  // — not the raw client-submitted value — and reference/supplier are
  // sanitized here too before either is written. scannedItemSchema's
  // `.refine()` (schemas/deliveryNoteScan.ts) only tests brand/reference's
  // RAW truthiness, so a whitespace-only brand (" ") passes it but composes
  // down to "" once sanitized: reject that case explicitly, on the COMPOSED
  // name, rather than silently write a nameless material — this is the
  // check that actually protects the write (see composeMaterialName's doc
  // comment in lib/materialName.ts).
  const supplier = sanitizeScannedNullableString(parsed.data.supplier);
  const materialItems = items.map((item) => {
    const brand = sanitizeScannedNullableString(item.brand);
    const reference = sanitizeScannedNullableString(item.reference);
    return {
      name: composeMaterialName(brand, reference),
      quantity: item.quantity,
      unit: null,
      reference,
      materialId: item.materialId ?? null,
    };
  });
  if (materialItems.some((item) => item.materialId == null && item.name === "")) {
    // Same fieldsForm gap as the schema-level branch above (adversarial pass
    // 2, point 4) — this check runs on the COMPOSED name, after the schema
    // has already passed, so there is no zod issue to translate; reuse the
    // same copy the review UI already shows for this exact case.
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: { items: t.materials.scan.missingBrandOrReference },
    };
  }

  const scopeCheck = await requireProjectAccess(projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  try {
    // clientId is resolved here, from the database, via the projectId that
    // just passed requireProjectAccess — never trusted from the form (it
    // was previously read straight off FormData and only ever used for
    // revalidatePath, with nothing checking it actually matched projectId).
    const project = await findProjectById(projectId);
    if (!project) {
      return { ...prevState, type: "error", message: t.projects.messages.invalidId };
    }

    // ORDER OF THIS STEP, and why (audit of fix/televersements): the stock used to be applied
    // BEFORE the archive, and a failed archive said "try again" — a retry then applied the
    // stock a second time. Now, strictly:
    //  1. everything cheap and read-only: the file's own validation (magic bytes + size, no
    //     decode), the materialIds against the project — the same verdict applyScanItems
    //     would reach (a materialId that matches no row of THIS project), asked BEFORE anything
    //     costly: a forged or stale list never spends decoder time — and the delivery-note
    //     folder (a read that fails must fail BEFORE a file is sent);
    //  2. the decode, its output ceiling, and the upload of the archive: every costly or
    //     fallible step that does not touch a row;
    //  3. the rows, in ONE transaction: the materials and the ProjectFile row (applyScanItems).
    //     If it fails, the asset just sent is compensated and nothing was applied: "try again"
    //     is true, and a retry cannot apply the stock twice.
    let validated: Awaited<ReturnType<typeof readAndValidateDeliveryNoteImage>> | null = null;
    if (file instanceof File && file.size > 0) {
      // Re-apply the scan's own allowlist (magic bytes + size) before handing the file to
      // the generic project-file uploader: this is a separate request from the scan step,
      // with its own file — nothing guarantees it's the same bytes the scan actually read.
      // The resolved { buffer, mediaType } feeds stripArchivedPhotoMetadata below —
      // mediaType is the type resolved from the file's actual content, never a cast of
      // the client-declared `file.type`.
      validated = await readAndValidateDeliveryNoteImage(file);
    }

    const wanted = [...new Set(materialItems.flatMap((item) => (item.materialId == null ? [] : [item.materialId])))];
    if (wanted.length > 0) {
      const inProject = new Set(await findMaterialIdsInProject(projectId, wanted));
      if (wanted.some((id) => !inProject.has(id))) {
        return { ...prevState, type: "error", message: t.materials.messages.invalidId };
      }
    }

    let deliveryFolderId: number | null = null;
    if (validated) {
      const rootFolders = await findChildFolders(projectId, null);
      deliveryFolderId = rootFolders.find((f) => f.name.toLowerCase() === "bulletins de livraisons")?.id ?? null;
    }

    // What the archive step produced, if it ran: compensated when the transaction fails.
    let archive: Awaited<ReturnType<typeof uploadProjectFile>> | null = null;
    let archivedName = "";
    // The cleaned image is beyond what the storage takes, even after being reduced to its pixel
    // ceiling: the stock is applied WITHOUT the archive, and the answer says so (a warning).
    let archiveTooLarge = false;
    if (file instanceof File && validated) {
      // The photo attached to the project is a supporting document: it keeps its original format
      // and, up to the storage's pixel ceiling, its full resolution (an image beyond it is reduced
      // to fit, proportions kept — the storage plan cannot keep it as it is, see
      // lib/cloudinary.ts); it never passes through reduceImageForModel, which only runs in
      // prepareDeliveryNoteImage, on the scan step's own request. Only its metadata (EXIF — GPS,
      // timestamp, device model; also ICC/XMP) is removed, per an explicit product decision (see
      // stripArchivedPhotoMetadata). The decode is the account's: `roleCheck.email`, resolved by
      // the role guard. A refusal of the decode (queue full, an image already in progress, out of
      // decode time, decoder down, a task killed at its deadline) fails the request HERE, before a
      // single row has changed, and never falls back to the un-cleaned original.
      let cleaned: Buffer | null = null;
      try {
        cleaned = await stripArchivedPhotoMetadata(roleCheck.email, validated.buffer, validated.mediaType, STORAGE_IMAGE_LIMITS);
      } catch (error) {
        if (isImageRefusal(error) && error.code === "outputTooLarge") archiveTooLarge = true;
        else throw scanErrorFromDecode(error);
      }
      if (cleaned) {
        // Content-free, like logScanEvent above: how the cleaned archive's size compares to the
        // original upload — useful to notice a stripping step that's silently no-op'ing on a class
        // of images — never what's inside either file.
        console.log("delivery_note_scan_archive", {
          userEmail: roleCheck.email,
          projectId,
          bytes: file.size,
          archivedBytes: cleaned.length,
        });
        // `new Uint8Array(cleaned)` rather than the Buffer itself: Node's Buffer type is
        // generic over ArrayBufferLike (it can be backed by a SharedArrayBuffer), while DOM's
        // BlobPart requires an ArrayBufferView<ArrayBuffer> specifically — this copies the
        // bytes into a plain Uint8Array TypeScript accepts here, it isn't a runtime fix.
        const archivedFile = new File([new Uint8Array(cleaned)], file.name, { type: validated.mediaType });
        archivedName = archivedFile.name;
        archive = await uploadProjectFile(archivedFile, projectId);
      }
    }

    // The rows, in ONE transaction: the materials and the archive's row. A failure compensates the
    // archive just sent (nothing references it unless the transaction committed after all) and the
    // error is the caller's: nothing was applied, retrying is safe.
    const uploaded = archive;
    await writeWithCompensation(
      () =>
        applyScanItems(
          projectId,
          materialItems,
          supplier,
          uploaded
            ? {
                projectId,
                folderId: deliveryFolderId,
                name: archivedName,
                url: uploaded.url,
                publicId: uploaded.publicId,
                deliveryType: uploaded.deliveryType,
                resourceType: uploaded.resourceType,
                format: uploaded.format,
                version: uploaded.version,
                size: uploaded.size,
                mimeType: uploaded.mimeType,
              }
            : undefined
        ),
      uploaded ? assetCompensation("delivery note archive", uploaded, isFilePublicIdReferenced, isUnmatchedScanMaterialError) : undefined
    );

    // Invalidates the hub (its Files link card shows a plain COUNT) and the
    // dedicated files page — the archive step above may have just created a
    // ProjectFile there. Reuses the same helper
    // actions/projectFiles/projectFiles.ts calls for its own four mutations
    // (lib/revalidateFiles.ts) rather than a second hard-coded revalidatePath,
    // so "what invalidating Files means" stays defined in one place.
    revalidateFiles(project.clientId, projectId);
    // applyScanItems above always writes at least one ProjectMaterial (a new
    // one, or an increment of an existing one's stock) — this second writer
    // of that model (the first is actions/projectMaterials/projectMaterials.ts)
    // needs the exact same two paths invalidated (lib/revalidateMaterials.ts,
    // same reasoning as revalidateFiles just above): the hub's Tâches link
    // card carries the materials count now, and the dedicated `.../tasks`
    // page is where Matériel actually renders.
    revalidateMaterials(project.clientId, projectId);
    // "warning": the stock IS applied, the archive is not. A state of its own (not "success" with another
    // text): the modal closes on every "success", and nobody would read the message.
    if (archiveTooLarge) {
      return {
        ...prevState,
        type: "warning",
        message: archiveTooLargeMessage(t),
      };
    }
    return { ...prevState, type: "success", message: t.materials.scan.messages.applied };
  } catch (error) {
    // readAndValidateDeliveryNoteImage and the decode (above) throw lib/deliveryNoteScan.ts's
    // own code-shaped error — checked and translated first. Everything else reachable in this
    // try block (repository/lib.cloudinary calls) throws this app's older
    // `{ type: "error", message }` shape; an unexpected native error's raw `.message` (e.g. a
    // bug elsewhere surfacing as a TypeError) never reaches the client.
    if (isScanError(error)) {
      return { ...prevState, type: "error", message: scanErrorMessage(t, error) };
    }
    // applyScanItems (repository/projectMaterials.ts) rolled the WHOLE batch
    // back because one of its materialId's matched no row in this project —
    // nothing was applied. Reusing t.materials.messages.invalidId (not a
    // scan-specific string) is deliberate: this is the exact same condition
    // editMaterial/deleteMaterial already report with that copy, just
    // discovered mid-batch instead of up front.
    if (isUnmatchedScanMaterialError(error)) {
      return { ...prevState, type: "error", message: t.materials.messages.invalidId };
    }
    // getErrorMessage relays only the application's own error shapes, and translates a
    // stable i18n code when the error carries one — e.g. uploadProjectFile
    // (lib/cloudinary.ts), whose English fallback used to be relayed verbatim — else the
    // generic message.
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}
