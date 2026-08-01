"use server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { can } from "@/lib/access";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { createUserSchema, updateUserSchema } from "@/schemas/user";
import { create, updateProfile, remove, findById, countSuperadmins, setUserProjects } from "@/repository/users";
import { updatePassword } from "@/repository/users";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { UserActionState } from "@/types/user";
import type { Role } from "@/app/generated/prisma/client";

type Actor = { role: Role; email: string };

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
  const t = getDictionary(await getLocale());

  const parsed = createUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  // An actor may only grant a role at or below their own rank.
  if (!hasMinRole(actor.role, parsed.data.role)) {
    return { ...prevState, type: "error", message: t.users.messages.cannotAssignHigher };
  }

  try {
    const password = await bcrypt.hash(parsed.data.password, 10);
    const user = await create({
      email: parsed.data.email,
      name: parsed.data.name ?? null,
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
  const t = getDictionary(await getLocale());

  const parsed = updateUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const target = await findById(parsed.data.id);
    if (!target) return { ...prevState, type: "error", message: t.errors.invalidId };

    // Can't manage a user whose CURRENT role outranks you, nor set a role above your own.
    if (!hasMinRole(actor.role, target.role) || !hasMinRole(actor.role, parsed.data.role)) {
      return { ...prevState, type: "error", message: t.users.messages.cannotManageHigher };
    }
    // Never demote the last SUPERADMIN.
    if (target.role === "SUPERADMIN" && parsed.data.role !== "SUPERADMIN" && (await countSuperadmins()) <= 1) {
      return { ...prevState, type: "error", message: t.users.messages.lastSuperadmin };
    }

    const user = await updateProfile(target.id, {
      name: parsed.data.name ?? null,
      role: parsed.data.role,
      jobFunctionId: parsed.data.jobFunctionId ?? null,
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
  const t = getDictionary(await getLocale());

  try {
    if (isNaN(id)) throw { type: "error", message: t.errors.invalidId };
    const target = await findById(id);
    if (!target) return { type: "error" as const, message: t.errors.invalidId };

    if (target.email === actor.email) {
      return { type: "error" as const, message: t.users.messages.cannotDeleteSelf };
    }
    if (!hasMinRole(actor.role, target.role)) {
      return { type: "error" as const, message: t.users.messages.cannotManageHigher };
    }
    if (target.role === "SUPERADMIN" && (await countSuperadmins()) <= 1) {
      return { type: "error" as const, message: t.users.messages.lastSuperadmin };
    }

    const user = await remove(id);
    revalidatePath("/admin/settings/utilisateurs");
    return { type: "success" as const, message: t.users.messages.deleted, data: user };
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
  const t = getDictionary(await getLocale());

  try {
    if (!Number.isInteger(userId) || userId <= 0) {
      return { type: "error" as const, message: t.errors.invalidId };
    }
    const target = await findById(userId);
    if (!target) return { type: "error" as const, message: t.errors.invalidId };
    if (!hasMinRole(actor.role, target.role)) {
      return { type: "error" as const, message: t.users.messages.cannotManageHigher };
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
