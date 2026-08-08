"use server";
import { headers } from "next/headers";
import { formDataToObject } from "@/lib/helpers";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import {
  extractDeliveryNoteItems,
  readAndValidateDeliveryNoteImage,
  scanProviderInfo,
} from "@/lib/deliveryNoteScan";
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
const SCAN_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };
// 60 scans/hour/IP — covers a small team sharing one office connection while
// still bounding spend from a single source (spray protection, same idea as
// LOGIN_IP_LIMIT in lib/loginRateLimit.ts).
const SCAN_IP_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

/**
 * Best-effort client IP from the proxy's forwarded headers — same pattern
 * (and same reasoning: the LAST hop is the one our proxy actually set, the
 * rest of the header is client-controlled) as actions/auth/auth.ts and
 * lib/authorizeCredentials.ts. Not extracted into a shared helper: this is a
 * third occurrence, which crosses this project's usual "beyond two,
 * extract" DRY threshold — flagged in the task report rather than done here,
 * since a new shared module isn't in this change's file scope.
 */
async function getClientIp(): Promise<string> {
  const h = await headers();
  const lastHop = h.get("x-forwarded-for")?.split(",").pop()?.trim();
  return lastHop || h.get("x-real-ip") || "unknown";
}

/**
 * getErrorMessage (lib/helpers.ts) relays the `.message` of ANY object that
 * carries one — including an Anthropic/OpenAI APIError, whose message can
 * contain the provider's HTTP status and raw response body (e.g. "invalid
 * x-api-key", quota details, sometimes an env var name). Only this app's own
 * thrown error shape (`{ type: "error", message }`, used throughout
 * lib/repository — see e.g. lib/cloudinary.ts) is safe to relay verbatim;
 * anything else must be logged server-side only and replaced with a generic
 * message before it reaches the client.
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

  // Reserve the attempt BEFORE checking the budget, same as
  // lib/authorizeCredentials.ts: checking first would reopen the exact race
  // that closes — a burst of concurrent requests could all observe "under
  // budget" before any of them had recorded, letting far more than
  // SCAN_LIMIT calls reach the paid provider before the count catches up.
  await Promise.all([registerFailure(userKey), registerFailure(ipKey)]);
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
    const { supplier, items } = await extractDeliveryNoteItems(file);
    logScanEvent({
      userEmail: roleCheck.email,
      projectId,
      provider,
      model,
      bytes: file.size,
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
    if (isAppError(error)) {
      return { ...prevState, type: "error", message: error.message };
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
 * (materialId absent), then attaches the original photo to the project's
 * files, inside the "Bulletins de livraisons" folder when one exists at the
 * project root.
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

  const { projectId, supplier, items } = parsed.data;
  const file = formData.get("file");

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

    await applyScanItems(projectId, items, supplier);

    if (file instanceof File && file.size > 0) {
      // Re-apply the scan's own allowlist (magic bytes + size) before
      // handing the file to the generic project-file uploader. This is a
      // separate request from the scan step, with its own file — nothing
      // guarantees it's the same bytes the scan actually read, so without
      // this it could reach uploadProjectFile never having been validated
      // as an actual image at all.
      await readAndValidateDeliveryNoteImage(file);
      const rootFolders = await findChildFolders(projectId, null);
      const deliveryFolder = rootFolders.find((f) => f.name.toLowerCase() === "bulletins de livraisons");
      const uploaded = await uploadProjectFile(file, projectId);
      await createFile({
        projectId,
        folderId: deliveryFolder?.id ?? null,
        name: file.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      });
    }

    revalidatePath(`/clients/${project.clientId}/projects/${projectId}`);
    return { ...prevState, type: "success", message: t.materials.scan.messages.applied };
  } catch (error) {
    // Nothing on this path touches the LLM SDK, so any thrown error here is
    // already this app's own shape (repository/lib conventions). Uses the
    // same isAppError guard as scanDeliveryNote rather than getErrorMessage,
    // for one consistent relay rule across this file instead of two — it
    // behaves identically for the errors this path actually throws, and
    // additionally stops an unexpected native error's raw `.message` (e.g.
    // a bug elsewhere surfacing as a TypeError) from reaching the client,
    // which getErrorMessage would have relayed verbatim.
    const message = isAppError(error) ? error.message : t.errors.serverError;
    return { ...prevState, type: "error", message };
  }
}
