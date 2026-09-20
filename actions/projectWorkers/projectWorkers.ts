"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { attachWorkerSchema } from "@/schemas/projectWorker";
import { attach, detach, findProjectId as findWorkerProjectId } from "@/repository/projectWorkers";
import { findById as findUserById } from "@/repository/users";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectWorkerActionState } from "@/types/projectWorker";

/**
 * Attaches an internal employee (a User) to a project as a "travailleur" —
 * mirrors actions/interims/interims.ts::addInterim's shape and guard order
 * (docs/CONVENTIONS.md). Gated by requireSectionAccess("interims"): there is
 * no dedicated "workers" project-section key (adding one would create a
 * section masquable that never existed for functions already configured —
 * see PROJECT_SECTION_KEYS, lib/projectSections.ts), and Travailleurs live on
 * the same `.../workforce` route as Intérimaires, under that route's
 * "interims" half of PROJECT_SECTION_ROUTES.
 */
export async function attachWorker(
  prevState: ProjectWorkerActionState,
  formData: FormData
): Promise<ProjectWorkerActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("interims");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = attachWorkerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  const scopeCheck = await requireProjectAccess(parsed.data.projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  try {
    // The role is resolved from the database, never trusted from the form:
    // the add-worker selector already excludes CLIENT logins
    // (repository/projectWorkers.ts::findAttachableUsers), but that list can
    // go stale between render and submit, and nothing stops a tampered
    // userId from naming one directly. A portal login is never an employee
    // (migration 20260920100000_project_workers, "WHAT THIS MIGRATION
    // DELIBERATELY DOES NOT ENFORCE" §1 — a FK proves the row exists, not
    // what kind of row it is).
    const user = await findUserById(parsed.data.userId);
    if (!user) return { ...prevState, type: "error", message: t.workers.messages.invalidId };
    if (user.role === "CLIENT") {
      return { ...prevState, type: "error", message: t.workers.messages.clientNotAllowed };
    }

    const worker = await attach(parsed.data.projectId, parsed.data.userId);
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}/workforce`);
    return { ...prevState, type: "success", message: t.workers.messages.added, data: worker };
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && error.type === "duplicate") {
      return { ...prevState, type: "error", message: t.workers.messages.alreadyAttached };
    }
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function detachWorker(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("interims");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.workers.messages.invalidId };
    }
    const realProjectId = await findWorkerProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.workers.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Same anti-enumeration rule as actions/interims/interims.ts::deleteInterim:
    // a travailleur that exists but sits outside the caller's scope must read
    // exactly like one that doesn't exist at all.
    if (scopeCheck.error) return { type: "error" as const, message: t.workers.messages.invalidId };
    const worker = await detach(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}/projects/${projectId}/workforce`);
    return { type: "success" as const, message: t.workers.messages.removed, data: worker };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
