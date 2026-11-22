"use server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { can } from "@/lib/access";
import { canAssignRole, canManageAccount, isOwnAccountLocked } from "@/lib/accountPolicy";
import { requireAreaAccess } from "@/lib/areaAccess";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { createUserSchema, updateUserSchema } from "@/schemas/user";
import {
  create,
  updateProfile,
  remove,
  findById,
  countSuperadmins,
  setUserProjects,
  countOwnershipBlockers,
} from "@/repository/users";
import { updatePassword } from "@/repository/users";
import { hasAnyAttachment } from "@/repository/projectWorkers";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { UserActionState } from "@/types/user";
import type { Role } from "@/app/generated/prisma/client";

type Actor = { role: Role; email: string };

type Dictionary = ReturnType<typeof getDictionary>;

/** The refusal to give when canManageAccount says no: a higher rank, or an administrator account. */
function manageRefusal(actorRole: Role, targetRole: Role, t: Dictionary): string {
  return hasMinRole(actorRole, targetRole) ? t.users.messages.adminRequiresSuperadmin : t.users.messages.cannotManageHigher;
}

/** The refusal to give when canAssignRole says no. */
function assignRefusal(actorRole: Role, role: Role, t: Dictionary): string {
  return hasMinRole(actorRole, role) ? t.users.messages.adminRequiresSuperadmin : t.users.messages.cannotAssignHigher;
}

/**
 * Gate on the configurable `users.manage` capability and return the actor's
 * role + email — needed for the privilege guards below (whatever the matrix
 * says, an actor may never grant or touch a role above their own).
 */
async function requireManager(): Promise<{ actor: Actor } | { error: { type: "error"; message: string } }> {
  const session = await auth();
  const t = getDictionary(await getLocale());
  if (!session) return { error: { type: "error", message: t.errors.unauthorized } };
  const role = session.user?.role;
  if (!(await can(role, "users.manage"))) return { error: { type: "error", message: t.errors.forbidden } };
  return { actor: { role: role as Role, email: session.user?.email ?? "" } };
}

export async function addUser(prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const gate = await requireManager();
  if ("error" in gate) return { ...prevState, ...gate.error };
  const { actor } = gate;
  const areaCheck = await requireAreaAccess("admin.users");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const t = getDictionary(await getLocale());

  const parsed = createUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  // An actor may only grant a role at or below their own rank, and only a
  // SUPERADMIN may create an ADMIN or above (lib/accountPolicy.ts).
  if (!canAssignRole(actor.role, parsed.data.role)) {
    return { ...prevState, type: "error", message: assignRefusal(actor.role, parsed.data.role, t) };
  }

  try {
    const password = await bcrypt.hash(parsed.data.password, 10);
    const user = await create({
      email: parsed.data.email,
      // createUserSchema's `name` is required (non-optional) — the `?? null`
      // this replaced was dead: parsed.data.name can never be undefined here.
      name: parsed.data.name,
      role: parsed.data.role,
      jobFunctionId: parsed.data.jobFunctionId ?? null,
      password,
    });
    revalidatePath("/admin/settings/utilisateurs");
    return { ...prevState, type: "success", message: t.users.messages.added, data: user };
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && error.type === "duplicate") {
      return { ...prevState, type: "error", message: t.users.messages.duplicate };
    }
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function updateUser(prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const gate = await requireManager();
  if ("error" in gate) return { ...prevState, ...gate.error };
  const { actor } = gate;
  const areaCheck = await requireAreaAccess("admin.users");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const t = getDictionary(await getLocale());

  const parsed = updateUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const target = await findById(parsed.data.id);
    if (!target) return { ...prevState, type: "error", message: t.errors.invalidId };

    // Whoever touches an ADMIN+ account goes through a SUPERADMIN; the one
    // exception is an ADMIN editing their OWN account (name, password), which
    // never changes its role (lib/accountPolicy.ts).
    const isSelf = target.email === actor.email;
    if (!canManageAccount(actor.role, target.role, isSelf)) {
      return { ...prevState, type: "error", message: manageRefusal(actor.role, target.role, t) };
    }
    if (parsed.data.role !== target.role) {
      if (isOwnAccountLocked(actor.role, isSelf) || !canAssignRole(actor.role, parsed.data.role)) {
        return { ...prevState, type: "error", message: assignRefusal(actor.role, parsed.data.role, t) };
      }
    }
    // Never demote the last SUPERADMIN.
    if (target.role === "SUPERADMIN" && parsed.data.role !== "SUPERADMIN" && (await countSuperadmins()) <= 1) {
      return { ...prevState, type: "error", message: t.users.messages.lastSuperadmin };
    }

    // Passe 3b, point 3: the second lever (besides setFunctionAreas) that
    // lifts every hiddenAreas/hiddenSections/projectScope restriction a
    // function imposes — repointing your OWN account at a different (or no)
    // function, in one call, without ever touching the function itself.
    // Proven during this pass alongside the setFunctionAreas gap. The escape
    // hatch stays SUPERADMIN, who bypasses hiddenAreas unconditionally
    // anyway (lib/accessContext.ts) — letting them repoint their own account
    // here changes nothing they can't already do.
    // "Absent" is not "empty": an omitted field keeps the CURRENT function,
    // only an explicit "" (parsed to null) clears it.
    const nextJobFunctionId =
      parsed.data.jobFunctionId === undefined ? target.jobFunctionId : parsed.data.jobFunctionId;
    if (isOwnAccountLocked(actor.role, isSelf) && nextJobFunctionId !== target.jobFunctionId) {
      return { ...prevState, type: "error", message: t.users.messages.cannotEditOwnFunction };
    }

    // Personne ne modifie la contrainte qui le contraint, appliqué ici dans
    // l'autre sens : un compte déjà RATTACHÉ à un projet comme travailleur
    // (ProjectWorker) ne peut pas devenir un login client — un login portail
    // n'est jamais un salarié (migration 20260920100000_project_workers,
    // "WHAT THIS MIGRATION DELIBERATELY DOES NOT ENFORCE" §1). Refusé plutôt
    // que détaché en silence : cette action modifie le rôle d'un compte, pas
    // la composition d'un chantier — un admin qui change juste le nom d'un
    // utilisateur ne doit jamais avoir pour effet de bord de le retirer de
    // tous ses chantiers.
    if (
      target.role !== "CLIENT" &&
      parsed.data.role === "CLIENT" &&
      (await hasAnyAttachment(target.id))
    ) {
      return { ...prevState, type: "error", message: t.users.messages.cannotSetClientWhileAttached };
    }

    const user = await updateProfile(target.id, {
      // Refactoring point 3 (revue + audit "travailleurs"): `name` is
      // `.optional()` in updateUserSchema, so an omitted field parses to
      // `undefined` — `?? null` here used to write NULL over an existing
      // name whenever the field was left off the payload, instead of leaving
      // it untouched. Falling back to the CURRENT name (read via findById
      // above) preserves it; a blank string is still rejected upstream by
      // Zod's `min(1)`, so this can never be used to erase a name either.
      name: parsed.data.name ?? target.name,
      role: parsed.data.role,
      jobFunctionId: nextJobFunctionId,
    });
    if (parsed.data.password) {
      await updatePassword(target.id, await bcrypt.hash(parsed.data.password, 10));
    }
    revalidatePath("/admin/settings/utilisateurs");
    return { ...prevState, type: "success", message: t.users.messages.updated, data: user };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function deleteUser(id: number) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { actor } = gate;
  const areaCheck = await requireAreaAccess("admin.users");
  if (areaCheck.error) return areaCheck.error;
  const t = getDictionary(await getLocale());

  try {
    if (isNaN(id)) throw { type: "error", message: t.errors.invalidId };
    const target = await findById(id);
    if (!target) return { type: "error" as const, message: t.errors.invalidId };

    if (target.email === actor.email) {
      return { type: "error" as const, message: t.users.messages.cannotDeleteSelf };
    }
    if (!canManageAccount(actor.role, target.role, false)) {
      return { type: "error" as const, message: manageRefusal(actor.role, target.role, t) };
    }
    if (target.role === "SUPERADMIN" && (await countSuperadmins()) <= 1) {
      return { type: "error" as const, message: t.users.messages.lastSuperadmin };
    }

    // Equipment.ownerId and EquipmentLoan.borrowerId (OPEN loans) are both
    // `onDelete: Restrict` (migration 20260918120000) — without this check,
    // deleting a user in either situation would fail at the database with a
    // generic 23503 instead of this explicit message. CLOSED loans are not a
    // blocker: remove() purges them in the same transaction as the delete.
    const blockers = await countOwnershipBlockers(id);
    if (blockers.equipmentCount > 0 || blockers.openLoanCount > 0) {
      return {
        type: "error" as const,
        message: format(t.users.messages.cannotDeleteHasEquipmentOrLoans, {
          equipment: blockers.equipmentCount,
          loans: blockers.openLoanCount,
        }),
      };
    }

    await remove(id);
    revalidatePath("/admin/settings/utilisateurs");
    // No `data`: the only reader (UsersManager) takes type + message, and the
    // deleted row is an account (password hash) with no business in a response.
    return { type: "success" as const, message: t.users.messages.deleted };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Assign a user to projects. Same gate as the rest of user management, plus the
 * same privilege rule: you may not manage someone who outranks you.
 */
export async function setUserProjectAssignments(userId: number, projectIds: number[]) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { actor } = gate;
  const areaCheck = await requireAreaAccess("admin.users");
  if (areaCheck.error) return areaCheck.error;
  const t = getDictionary(await getLocale());

  try {
    if (!Number.isInteger(userId) || userId <= 0) {
      return { type: "error" as const, message: t.errors.invalidId };
    }
    const target = await findById(userId);
    if (!target) return { type: "error" as const, message: t.errors.invalidId };
    if (!canManageAccount(actor.role, target.role, false)) {
      return { type: "error" as const, message: manageRefusal(actor.role, target.role, t) };
    }

    const ids = Array.isArray(projectIds)
      ? [...new Set(projectIds.filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    await setUserProjects(userId, ids);
    revalidatePath("/admin/settings/utilisateurs");
    return { type: "success" as const, message: t.users.messages.updated };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
