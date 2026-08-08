"use server";
import { formDataToObject } from "@/lib/helpers";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/clientIp";
import {
  extractDeliveryNoteItems,
  readAndValidateDeliveryNoteImage,
  stripArchivedPhotoMetadata,
  scanProviderInfo,
  isScanError,
} from "@/lib/deliveryNoteScan";
import { composeMaterialName, sanitizeScannedNullableString } from "@/lib/materialName";
import { applyDeliveryScanSchema } from "@/schemas/deliveryNoteScan";
import { applyScanItems } from "@/repository/projectMaterials";
import { create as createFile } from "@/repository/projectFiles";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { findById as findProjectById } from "@/repository/projects";
import { uploadProjectFile } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
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

/**
 * getErrorMessage (lib/helpers.ts) relays the `.message` of ANY object that
 * carries one — including an Anthropic/OpenAI APIError, whose message can
 * contain the provider's HTTP status and raw response body (e.g. "invalid
 * x-api-key", quota details, sometimes an env var name). Only this app's own
 * thrown error shape (`{ type: "error", message }`, used throughout
 * lib/repository — see e.g. lib/cloudinary.ts) is safe to relay verbatim;
 * anything else must be logged server-side only and replaced with a generic
 * message before it reaches the client. Distinct from isScanError
 * (lib/deliveryNoteScan.ts), which carries a `code` to translate via
 * t.materials.scan.errors (lib/i18n/dictionaries/{fr,en}.ts) rather than a
 * message to relay.
 */
function isAppError(error: unknown): error is { type: "error"; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "error" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

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
  await Promise.all([registerFailure(userKey), registerFailure(ipKey)]);

  const { provider, model } = scanProviderInfo();
  const startedAt = Date.now();

  try {
    const { supplier, items, bytesSent } = await extractDeliveryNoteItems(file);
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
      return { ...prevState, type: "error", message: t.materials.scan.errors[error.code] };
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
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = applyDeliveryScanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError };
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
    return { ...prevState, type: "zodError", message: t.errors.validationError };
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

    // Built before either database write below (applyScanItems, createFile):
    // if stripArchivedPhotoMetadata throws (a corrupted buffer sharp can't
    // process), the whole request fails right here, before a single row has
    // changed — the caller retries on an untouched state. Never falls back
    // to archiving the un-cleaned original on failure, which would silently
    // undo the product decision this exists to apply.
    let archivedFile: File | null = null;
    if (file instanceof File && file.size > 0) {
      // Re-apply the scan's own allowlist (magic bytes + size) before
      // handing the file to the generic project-file uploader. This is a
      // separate request from the scan step, with its own file — nothing
      // guarantees it's the same bytes the scan actually read, so without
      // this it could reach uploadProjectFile never having been validated
      // as an actual image at all.
      // Its resolved { buffer, mediaType } feeds stripArchivedPhotoMetadata
      // below (lib/deliveryNoteScan.ts) — mediaType is the type resolved
      // from the file's actual content, never a cast of the client-declared
      // `file.type`. The photo attached to the project is a supporting
      // document, so it keeps its full resolution and original format; it
      // never passes through reduceImageForModel (lib/deliveryNoteScan.ts),
      // which only ever runs inside extractDeliveryNoteItems, on the scan
      // step's own request, and is bounded/re-encoded for the model only.
      // This archive only has its metadata (EXIF — GPS, timestamp, device
      // model; also ICC/XMP) removed, per an explicit product decision —
      // see stripArchivedPhotoMetadata's own comment.
      const { buffer, mediaType } = await readAndValidateDeliveryNoteImage(file);
      const cleaned = await stripArchivedPhotoMetadata(buffer, mediaType);
      // `new Uint8Array(cleaned)` rather than the Buffer itself: Node's
      // Buffer type is generic over ArrayBufferLike (it can be backed by a
      // SharedArrayBuffer), while DOM's BlobPart requires an
      // ArrayBufferView<ArrayBuffer> specifically — this copies the bytes
      // into a plain Uint8Array TypeScript accepts here, it isn't a runtime
      // fix for anything.
      archivedFile = new File([new Uint8Array(cleaned)], file.name, { type: mediaType });
      // Content-free, like logScanEvent above: how the cleaned archive's
      // size compares to the original upload — useful to notice a stripping
      // step that's silently no-op'ing on a class of images — never what's
      // inside either file.
      console.log("delivery_note_scan_archive", {
        userEmail: roleCheck.email,
        projectId,
        bytes: file.size,
        archivedBytes: cleaned.length,
      });
    }

    await applyScanItems(projectId, materialItems, supplier);

    if (archivedFile) {
      const rootFolders = await findChildFolders(projectId, null);
      const deliveryFolder = rootFolders.find((f) => f.name.toLowerCase() === "bulletins de livraisons");
      const uploaded = await uploadProjectFile(archivedFile, projectId);
      await createFile({
        projectId,
        folderId: deliveryFolder?.id ?? null,
        name: archivedFile.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        deliveryType: uploaded.deliveryType,
        resourceType: uploaded.resourceType,
        format: uploaded.format,
        version: uploaded.version,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      });
    }

    revalidatePath(`/clients/${project.clientId}/projects/${projectId}`);
    return { ...prevState, type: "success", message: t.materials.scan.messages.applied };
  } catch (error) {
    // readAndValidateDeliveryNoteImage (above) throws lib/deliveryNoteScan.ts's
    // own code-shaped error — checked and translated first. Everything else
    // reachable in this try block (repository/lib.cloudinary calls) still
    // throws this app's older `{ type: "error", message }` shape, relayed via
    // isAppError as before; an unexpected native error's raw `.message`
    // (e.g. a bug elsewhere surfacing as a TypeError) never reaches the
    // client, which getErrorMessage would have relayed verbatim.
    if (isScanError(error)) {
      return { ...prevState, type: "error", message: t.materials.scan.errors[error.code] };
    }
    const message = isAppError(error) ? error.message : t.errors.serverError;
    return { ...prevState, type: "error", message };
  }
}
