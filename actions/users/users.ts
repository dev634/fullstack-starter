"use server";
import bcrypt from "bcryptjs";
import { auth, signOut } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { can } from "@/lib/access";
import {
  canAssignRole,
  canManageAccount,
  isOwnAccountLocked,
  isRestrictedAdmin,
  mayManageAccountWithFunction,
  type AccountActor,
} from "@/lib/accountPolicy";
import { getAccessContext } from "@/lib/accessContext";
import type { AppAreaKey } from "@/lib/appAreas";
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
  type RelayCheck,
} from "@/repository/users";
import { findHiddenAreasById, isGuardRefusal } from "@/repository/jobFunctions";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { UserActionState } from "@/types/user";
import type { Role } from "@/app/generated/prisma/client";

type Actor = { role: Role; email: string; hiddenAreas: ReadonlySet<AppAreaKey> };

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
 * The same rule, as the predicate the repository evaluates INSIDE the
 * transaction that writes the account, under the function's row lock
 * (repository/users.ts::RelayCheck). `null` for anyone the rule never refuses.
 * This is the authoritative check: the ones above it in each action read the
 * function in a separate round trip and only refuse early (and before the
 * password is hashed) — a parallel reconfiguration of the function can slip in
 * after them, never past this one.
 */
function relayCheckFor(actor: AccountActor): RelayCheck | null {
  return isRestrictedAdmin(actor) ? (hidden) => mayManageAccountWithFunction(actor, hidden) : null;
}

/**
 * The relay rule (lib/accountPolicy.ts::mayManageAccountWithFunction) for ONE
 * account state: the function it holds (`null` = none). The read of the
 * function's hiddenAreas only happens for a restricted ADMIN — everyone else is
 * never refused by this rule, so it costs them nothing.
 */
async function mayManageWithFunction(actor: AccountActor, jobFunctionId: number | null): Promise<boolean> {
  if (!isRestrictedAdmin(actor)) return true;
  const hidden: AppAreaKey[] = jobFunctionId === null ? [] : await findHiddenAreasById(jobFunctionId);
  return mayManageAccountWithFunction(actor, hidden);
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
  // hiddenAreas: the one restriction an ADMIN is subject to (SUPERADMIN: none,
  // resolved without a lookup) — it drives the relay rule, see accountPolicy.
  const ctx = await getAccessContext();
  return { actor: { role: role as Role, email: session.user?.email ?? "", hiddenAreas: ctx.hiddenAreas } };
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

  // A portal login is only ever created from its contact (createPortalLogin):
  // never here, whoever asks. Answers like updateUser does for the same role.
  if (parsed.data.role === "CLIENT") {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }

  // An actor may only grant a role at or below their own rank, and only a
  // SUPERADMIN may create an ADMIN or above (lib/accountPolicy.ts).
  if (!canAssignRole(actor.role, parsed.data.role)) {
    return { ...prevState, type: "error", message: assignRefusal(actor.role, parsed.data.role, t) };
  }
  // A restricted ADMIN creates only accounts that stay as restricted as they are.
  if (!(await mayManageWithFunction(actor, parsed.data.jobFunctionId ?? null))) {
    return { ...prevState, type: "error", message: t.users.messages.restrictedAdminAccount };
  }

  try {
    // Hashed BEFORE the repository's transaction: nothing slow sits between
    // the relay check and the insert.
    const password = await bcrypt.hash(parsed.data.password, 10);
    const user = await create(
      {
        email: parsed.data.email,
        // createUserSchema's `name` is required (non-optional) — the `?? null`
        // this replaced was dead: parsed.data.name can never be undefined here.
        name: parsed.data.name,
        role: parsed.data.role,
        jobFunctionId: parsed.data.jobFunctionId ?? null,
        password,
      },
      relayCheckFor(actor)
    );
    revalidatePath("/admin/settings/utilisateurs");
    return { ...prevState, type: "success", message: t.users.messages.added, data: { id: user.id } };
  } catch (error) {
    if (isGuardRefusal(error)) return { ...prevState, type: "error", message: t.users.messages.restrictedAdminAccount };
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

  // Set once the write succeeded on the caller's OWN account and changed what
  // its sessions were issued for (password, role): see the sign-out below.
  let endsOwnSession = false;
  let result: UserActionState;
  try {
    const target = await findById(parsed.data.id);
    if (!target) return { ...prevState, type: "error", message: t.errors.invalidId };

    // A portal login is NEVER managed here, and never made here either —
    // whoever asks, whatever the field (name, function, password, role): it is
    // provisioned and managed from its contact (createPortalLogin). The portal
    // ignores hiddenAreas, so a restricted ADMIN who set its password could read
    // the projects they cannot see; promoting one minted an account with no
    // function; making one hands the caller an account on a path none of the
    // rules covers. Answers like an absent account — the users screen does not
    // list CLIENT accounts.
    if (target.role === "CLIENT" || parsed.data.role === "CLIENT") {
      return { ...prevState, type: "error", message: t.errors.invalidId };
    }

    // Whoever touches an ADMIN+ account goes through a SUPERADMIN; the one
    // exception is an ADMIN editing their OWN account (name, password), which
    // never changes its role (lib/accountPolicy.ts).
    const isSelf = target.email === actor.email;
    if (!canManageAccount(actor.role, target.role, isSelf)) {
      return { ...prevState, type: "error", message: manageRefusal(actor.role, target.role, t) };
    }
    // Relay rule, BEFORE: a restricted ADMIN does not take over an account
    // whose function hides less than theirs (name, role, function, password: any change).
    if (!(await mayManageWithFunction(actor, target.jobFunctionId))) {
      return { ...prevState, type: "error", message: t.users.messages.restrictedAdminAccount };
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

    // Passe 3b, point 3: the second lever (besides saveFunctionConfig) that
    // lifts every hiddenAreas/hiddenSections/projectScope restriction a
    // function imposes — repointing your OWN account at a different (or no)
    // function, in one call, without ever touching the function itself.
    // Proven during this pass alongside the saveFunctionConfig gap. The escape
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
    // Relay rule, AFTER: nor does it hand the account a function that hides less.
    if (nextJobFunctionId !== target.jobFunctionId && !(await mayManageWithFunction(actor, nextJobFunctionId))) {
      return { ...prevState, type: "error", message: t.users.messages.restrictedAdminAccount };
    }

    // Hashed BEFORE the repository's transaction (nothing slow between the
    // relay check and the write); `undefined` = the password is left alone.
    const password = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : undefined;
    await updateProfile(
      target.id,
      {
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
        password,
      },
      relayCheckFor(actor)
    );
    revalidatePath("/admin/settings/utilisateurs");
    // updateProfile bumped sessionVersion (password or role changed): this very
    // cookie is already dead. Sign out explicitly, with the reason, instead of
    // letting the next request bounce to /login unexplained.
    endsOwnSession = isSelf && (password !== undefined || parsed.data.role !== target.role);
    result = { ...prevState, type: "success", message: t.users.messages.updated };
  } catch (error) {
    if (isGuardRefusal(error)) return { ...prevState, type: "error", message: t.users.messages.restrictedAdminAccount };
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
  // OUTSIDE the try/catch on purpose: signOut throws the redirect, and the
  // catch above would turn it into a "server error" message.
  if (endsOwnSession) await signOut({ redirectTo: "/login?raison=identifiants-modifies" });
  return result;
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
    if (!(await mayManageWithFunction(actor, target.jobFunctionId))) {
      return { type: "error" as const, message: t.users.messages.restrictedAdminAccount };
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
    // A portal login's projects are its contact's (ContactProjects), not this
    // relation — and it is never a salaried account. Same answer as absent.
    if (!target || target.role === "CLIENT") return { type: "error" as const, message: t.errors.invalidId };
    if (!canManageAccount(actor.role, target.role, false)) {
      return { type: "error" as const, message: manageRefusal(actor.role, target.role, t) };
    }
    if (!(await mayManageWithFunction(actor, target.jobFunctionId))) {
      return { type: "error" as const, message: t.users.messages.restrictedAdminAccount };
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
