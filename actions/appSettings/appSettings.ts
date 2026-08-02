"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { resolveAccessConfig } from "@/lib/capabilities";
import { updateAppSettingsSchema } from "@/schemas/appSettings";
import { getSettings, upsert, updateSectionOrder, updateAccessConfig } from "@/repository/appSettings";
import { uploadLogo as uploadLogoToCloudinary, destroyLogo } from "@/lib/cloudinary";
import { revalidateTag } from "next/cache";
import { APP_SETTINGS_TAG } from "@/lib/appSettings";
import { normalizeSectionOrder } from "@/lib/projectSections";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { AppSettingsActionState } from "@/types/appSettings";

// Local (not exported): a "use server" file may only export async functions,
// and the client infers this return type from the action itself.
type SectionOrderResult = { ok: true } | { ok: false; message: string };

/**
 * Persists the RBAC matrix (capability -> min role). The incoming map is
 * resolved server-side (unknown/invalid entries dropped, locked capabilities
 * forced back to their default) so a tampered payload can never lower the bar
 * on settings.manage and lock the owner out. Gated by settings.manage itself
 * (locked to SUPERADMIN).
 */
export async function setAccessConfig(config: Record<string, string>): Promise<SectionOrderResult> {
  const roleCheck = await requireCapability("settings.manage");
  if (roleCheck.error) return { ok: false, message: roleCheck.error.message };
  const areaCheck = await requireAreaAccess("admin.settings");
  if (areaCheck.error) return { ok: false, message: areaCheck.error.message };

  const t = getDictionary(await getLocale());
  try {
    const resolved = resolveAccessConfig(config);
    await updateAccessConfig(resolved, roleCheck.email);
    revalidateTag(APP_SETTINGS_TAG, "max");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Persists the drag-and-drop section order. Called imperatively from the
 * client on each drop (not a form action) — the incoming order is normalized
 * server-side so a partial or tampered payload can never corrupt the stored
 * value. SUPERADMIN only.
 */
export async function updateProjectSectionOrder(order: string[]): Promise<SectionOrderResult> {
  const roleCheck = await requireRole("SUPERADMIN");
  if (roleCheck.error) return { ok: false, message: roleCheck.error.message };
  const areaCheck = await requireAreaAccess("admin.settings");
  if (areaCheck.error) return { ok: false, message: areaCheck.error.message };

  const t = getDictionary(await getLocale());
  try {
    await updateSectionOrder(normalizeSectionOrder(order), roleCheck.email);
    revalidateTag(APP_SETTINGS_TAG, "max");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function updateSettings(
  prevState: AppSettingsActionState,
  formData: FormData
): Promise<AppSettingsActionState> {
  const roleCheck = await requireRole("SUPERADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("admin.settings");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateAppSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const current = await getSettings();
    await upsert({
      appName: parsed.data.appName,
      logoUrl: current.logoUrl,
      logoPublicId: current.logoPublicId,
      primaryColor: parsed.data.primaryColor,
      accentColor: parsed.data.accentColor,
      updatedBy: roleCheck.email,
    });
    revalidateTag(APP_SETTINGS_TAG, "max");
    return { ...prevState, type: "success", message: t.appSettings.messages.updated };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function uploadLogo(
  prevState: AppSettingsActionState,
  formData: FormData
): Promise<AppSettingsActionState> {
  const roleCheck = await requireRole("SUPERADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("admin.settings");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.errors.validationError };
  }

  try {
    const current = await getSettings();
    const { url, publicId } = await uploadLogoToCloudinary(file);
    await upsert({
      appName: current.appName,
      logoUrl: url,
      logoPublicId: publicId,
      primaryColor: current.primaryColor,
      accentColor: current.accentColor,
      updatedBy: roleCheck.email,
    });
    // Best-effort cleanup of the previous logo, after the new one is saved.
    await destroyLogo(current.logoPublicId);
    revalidateTag(APP_SETTINGS_TAG, "max");
    return { ...prevState, type: "success", message: t.appSettings.messages.logoUploaded };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function removeLogo(): Promise<AppSettingsActionState> {
  const roleCheck = await requireRole("SUPERADMIN");
  if (roleCheck.error) return { type: "error", message: roleCheck.error.message };
  const areaCheck = await requireAreaAccess("admin.settings");
  if (areaCheck.error) return { type: "error", message: areaCheck.error.message };

  const t = getDictionary(await getLocale());
  try {
    const current = await getSettings();
    await upsert({
      appName: current.appName,
      logoUrl: null,
      logoPublicId: null,
      primaryColor: current.primaryColor,
      accentColor: current.accentColor,
      updatedBy: roleCheck.email,
    });
    await destroyLogo(current.logoPublicId);
    revalidateTag(APP_SETTINGS_TAG, "max");
    return { type: "success", message: t.appSettings.messages.logoRemoved };
  } catch (error) {
    return {
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
