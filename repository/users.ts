import { prisma } from "@/lib/prisma";
import { hashResetToken } from "@/lib/resetToken";
import { Prisma, type Role } from "@/app/generated/prisma/client";
import { PRIVILEGED_ROLES } from "@/lib/accountPolicy";
import { normalizeEmail } from "@/lib/normalizeEmail";

/**
 * THE filter every "who IS the caller" resolution applies to `User` — today,
 * by email alone. Not a convenience copy of `{ email }`: this is the single
 * place that question is answered, so a future deactivation field
 * (`User.deactivatedAt`, say) would plug in here once (`deactivatedAt: null`) instead of a second copy of the
 * rule drifting from this one. A deactivated account would then read as
 * "introuvable" wherever a session resolves to a row, exactly like a deleted
 * one — and every caller below (and lib/sessionGate.ts) inherits that for
 * free.
 *
 * `satisfies` against both shapes it's asked to fill keeps it honest: it must
 * compile as a `Prisma.UserWhereUniqueInput` (`findUnique`'s `where`) AND as a
 * `Prisma.UserWhereInput` (a nested relation filter, e.g.
 * `where: { user: sessionAccountWhere(email) }`).
 *
 * The e-mail is normalized here (lib/normalizeEmail.ts), as in `create` and
 * `findByEmail`: one canonical form on every write and every lookup.
 *
 * Deliberately NOT applied to `findByEmail` below — that one backs sign-in
 * (verifyCredentials) and password reset, a call this pass does not make, so
 * both keep finding a deactivated row. What that does, once the column
 * exists: the account CAN still sign in or reset its password; from the next
 * request on, every resolver above reads it as "introuvable" and the gate
 * (lib/sessionGate.ts) voids its token, so it lands back on /login. What it
 * does NOT do is tell the account why — nothing in this design produces a
 * message, a refusal at sign-in, or a "deactivated" state anywhere. Surfacing
 * the reason would be a product decision, not made here.
 */
export function sessionAccountWhere(email: string) {
    return { email: normalizeEmail(email) } satisfies Prisma.UserWhereUniqueInput satisfies Prisma.UserWhereInput;
}

/** App users for the management screen (without password hashes). Excludes
 * CLIENT portal logins — those are managed from their contact, not here.
 * Includes each user's job function (id + name) for display + edit. */
export async function findAll() {
    try {
        return await prisma.user.findMany({
            where: { role: { not: "CLIENT" } },
            select: {
                assignedProjects: { select: { id: true } },
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                jobFunctionId: true,
                jobFunction: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findAll (user) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching users." };
    }
}

/**
 * The project-section and app-area keys hidden from a user, via their job
 * function's `hiddenSections`/`hiddenAreas`. Empty when the user has no
 * function (or it hides nothing).
 */
export type AccessScope = {
    hiddenSections: string[];
    hiddenAreas: string[];
    projectScope: "ALL" | "ASSIGNED";
    assignedProjectIds: number[];
};

/**
 * Everything the access context needs about one user, in a single query: the
 * sections and top-level areas their function withholds, whether that
 * function restricts them to assigned projects, and which projects those are.
 *
 * One round-trip on purpose — this runs on every request that renders or
 * filters project data.
 */
export async function findAccessScopeByEmail(email: string): Promise<AccessScope | null> {
    try {
        const user = await prisma.user.findUnique({
            where: sessionAccountWhere(email),
            select: {
                jobFunction: { select: { hiddenSections: true, hiddenAreas: true, projectScope: true } },
                assignedProjects: { select: { id: true } },
            },
        });
        if (!user) return null;

        return {
            hiddenSections: user.jobFunction?.hiddenSections ?? [],
            hiddenAreas: user.jobFunction?.hiddenAreas ?? [],
            // No function means no restriction — a user must not lose access
            // just because nobody has given them a job title yet.
            projectScope: user.jobFunction?.projectScope ?? "ALL",
            assignedProjectIds: user.assignedProjects.map((p) => p.id),
        };
    } catch (error) {
        console.log("Repository findAccessScopeByEmail error:", error);
        throw { type: "repositoryError", message: "Database Error fetching access scope." };
    }
}

/**
 * A user's numeric id by email, WITHOUT the password hash or any other
 * column — unlike findByEmail (used only by the credentials provider's own
 * check), this is read by every mutation that needs to resolve "which row IS
 * the current caller" (lib/currentUser.ts's getCurrentUserId, consumed by
 * the equipment-loans module for ownership/borrower identity) and must never
 * pull a hash into a server action's memory for no reason.
 */
export async function findIdByEmail(email: string): Promise<number | null> {
    try {
        const user = await prisma.user.findUnique({ where: sessionAccountWhere(email), select: { id: true } });
        return user?.id ?? null;
    } catch (error) {
        console.log("Repository findIdByEmail error:", error);
        throw { type: "repositoryError", message: "Database Error fetching user id." };
    }
}

/**
 * Whether `email` STILL resolves to the SAME account `id` — the check
 * lib/sessionGate.ts runs on every session: a deleted account's last-issued
 * JWT must stop authenticating, and a deleted-then-recreated account under
 * the same email must not hand the new row the old cookie's session. Indexed
 * on id AND email together for exactly that second case — ids are never
 * reused, so a stale `sub` can't resolve to whatever row the email now
 * belongs to.
 */
export async function findSessionAccount(id: number, email: string): Promise<{ id: number } | null> {
    try {
        return await prisma.user.findUnique({
            where: { id, ...sessionAccountWhere(email) },
            select: { id: true },
        });
    } catch (error) {
        console.log("Repository findSessionAccount error:", error);
        throw { type: "repositoryError", message: "Database Error fetching session account." };
    }
}

/**
 * Candidate borrowers for the Prêts module: every internal user except the
 * caller (excludeUserId) and CLIENT portal logins, which never take part in
 * equipment loans. Projected to {id, name} for a <select> — never the full
 * row, which carries a password hash and access-posture fields no picker
 * needs (docs/CONVENTIONS.md's "a list that only feeds a <select> projects
 * to {id, label}").
 */
export async function findBorrowerOptions(
    excludeUserId: number
): Promise<{ id: number; name: string | null }[]> {
    try {
        return await prisma.user.findMany({
            where: { role: { not: "CLIENT" }, id: { not: excludeUserId } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
    } catch (error) {
        console.log("Repository findBorrowerOptions error:", error);
        throw { type: "repositoryError", message: "Database Error fetching borrower options." };
    }
}

/** How many pieces of equipment a user owns, and how many OPEN loans they
 * currently hold as a borrower. */
export type OwnershipBlockers = { equipmentCount: number; openLoanCount: number };

/**
 * Equipment.ownerId and EquipmentLoan.borrowerId are both `onDelete:
 * Restrict` (migration 20260918120000) — deleting a user who still owns
 * equipment, or still holds an OPEN loan, would otherwise fail at the
 * database with a generic 23503. deleteUser (actions/users/users.ts) calls
 * this FIRST so it can refuse with an explicit message instead of surfacing
 * that as a server error. CLOSED loans are not a blocker — they are purged
 * in the same transaction as the delete itself, see remove() below.
 */
export async function countOwnershipBlockers(userId: number): Promise<OwnershipBlockers> {
    try {
        const [equipmentCount, openLoanCount] = await Promise.all([
            prisma.equipment.count({ where: { ownerId: userId } }),
            prisma.equipmentLoan.count({ where: { borrowerId: userId, returnedAt: null } }),
        ]);
        return { equipmentCount, openLoanCount };
    } catch (error) {
        console.log("Repository countOwnershipBlockers error:", error);
        throw { type: "repositoryError", message: "Database Error counting equipment/loan ownership." };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.user.findUnique({
            where: { id },
            // Explicit select, excludes password — id/email/role/jobFunctionId
            // are read by callers (privilege + self-lock checks in
            // actions/users/users.ts — jobFunctionId added for the passe 3b,
            // point 3 self-lock guard: it lets updateUser compare a submitted
            // jobFunctionId against the target's CURRENT one without a second
            // query; name added by the refactoring point that fixed updateUser
            // writing NULL over an existing name when the form field is
            // omitted — it lets updateUser fall back to the CURRENT name
            // without a second query too).
            select: { id: true, email: true, role: true, jobFunctionId: true, name: true },
        });
    } catch (error) {
        console.log("Repository findById (user) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching user." };
    }
}

/**
 * The raw jobFunctionId currently assigned to a user, by email — distinct
 * from findAccessScopeByEmail above, which returns what that function
 * RESOLVES to (hiddenSections/hiddenAreas/projectScope), not the id itself.
 * Passe 3b, point 3: saveFunctionConfig (actions/jobFunctions/jobFunctions.ts)
 * needs the caller's OWN function id to refuse editing it.
 *
 * `null` means "no account" (sessionAccountWhere found no row); `{
 * jobFunctionId: null }` means "account, no function". Collapsing the two —
 * the bug this rename closes — let deleteJobFunction/saveFunctionConfig treat
 * a caller whose account just vanished as merely "has no function", i.e.
 * nothing stops it: `ownFunctionId === id` is `null === id`, always false,
 * so the self-lock guard silently let the call through instead of refusing
 * it outright.
 */
export async function findAccountJobFunctionByEmail(email: string): Promise<{ jobFunctionId: number | null } | null> {
    try {
        return await prisma.user.findUnique({ where: sessionAccountWhere(email), select: { jobFunctionId: true } });
    } catch (error) {
        console.log("Repository findAccountJobFunctionByEmail error:", error);
        throw { type: "repositoryError", message: "Database Error fetching user's job function." };
    }
}

/**
 * How many ADMIN / SUPERADMIN accounts hold this job function. A function
 * carried by one of them is a constraint ON that administrator: whoever edits
 * or deletes it (onDelete: SetNull detaches its holders) lifts or imposes
 * restrictions on an account only a SUPERADMIN may touch
 * (lib/accountPolicy.ts). Read by actions/jobFunctions.
 */
export async function countPrivilegedHolders(jobFunctionId: number): Promise<number> {
    try {
        return await prisma.user.count({ where: { jobFunctionId, role: { in: PRIVILEGED_ROLES } } });
    } catch (error) {
        console.log("Repository countPrivilegedHolders error:", error);
        throw { type: "repositoryError", message: "Database Error counting function holders." };
    }
}

/**
 * The same question for the whole list, for the functions screen: ids of the
 * job functions held by at least one ADMIN / SUPERADMIN account — exactly the
 * ones countPrivilegedHolders refuses to a non-SUPERADMIN.
 */
export async function findFunctionIdsHeldByPrivileged(): Promise<number[]> {
    try {
        const rows = await prisma.user.findMany({
            where: { jobFunctionId: { not: null }, role: { in: PRIVILEGED_ROLES } },
            select: { jobFunctionId: true },
            distinct: ["jobFunctionId"],
        });
        return rows.flatMap((r) => (r.jobFunctionId === null ? [] : [r.jobFunctionId]));
    } catch (error) {
        console.log("Repository findFunctionIdsHeldByPrivileged error:", error);
        throw { type: "repositoryError", message: "Database Error listing function holders." };
    }
}

export async function create(data: {
    email: string;
    name: string | null;
    role: Role;
    password: string;
    jobFunctionId?: number | null;
}) {
    try {
        return await prisma.user.create({
            data: { ...data, email: normalizeEmail(data.email), jobFunctionId: data.jobFunctionId ?? null },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                jobFunctionId: true,
                jobFunction: { select: { name: true } },
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "A user with this email already exists." };
        }
        console.log("Repository create (user) error:", error);
        throw { type: "repositoryError", message: "Database Error creating user." };
    }
}

export async function updateProfile(
    id: number,
    // jobFunctionId is REQUIRED (number = set, null = clear): an optional one
    // collapsed to NULL here, so a caller that merely omitted it erased the
    // function. The caller resolves "omitted" to the current value first.
    data: { name: string | null; role: Role; jobFunctionId: number | null }
) {
    try {
        return await prisma.user.update({
            where: { id },
            data,
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                jobFunctionId: true,
                jobFunction: { select: { name: true } },
            },
        });
    } catch (error) {
        console.log("Repository updateProfile (user) error:", error);
        throw { type: "repositoryError", message: "Database Error updating user." };
    }
}

/**
 * Delete a user, purging their CLOSED loans (as a borrower) in the SAME
 * transaction first — deliberate decision: the loan history of someone who
 * has left is dropped along with their account rather than kept orphaned.
 * Callers must check countOwnershipBlockers() first and refuse explicitly
 * when it's non-zero: owned equipment and OPEN borrowed loans are `onDelete:
 * Restrict`, so leaving either in place would abort this transaction with a
 * generic 23503 instead of the explicit message deleteUser gives.
 */
export async function remove(id: number) {
    try {
        return await prisma.$transaction(async (tx) => {
            await tx.equipmentLoan.deleteMany({ where: { borrowerId: id, returnedAt: { not: null } } });
            // Explicit select: the bare row carries the password hash, and the
            // caller (actions/users/users.ts::deleteUser) only needs to know it
            // succeeded.
            return await tx.user.delete({ where: { id }, select: { id: true } });
        });
    } catch (error) {
        console.log("Repository remove (user) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting user." };
    }
}

/** How many SUPERADMIN accounts exist — guards against removing the last one. */
export async function countSuperadmins() {
    try {
        return await prisma.user.count({ where: { role: "SUPERADMIN" } });
    } catch (error) {
        console.log("Repository countSuperadmins error:", error);
        throw { type: "repositoryError", message: "Database Error counting admins." };
    }
}

export async function findByEmail(email: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { email: normalizeEmail(email) },
        });
        return user;
    } catch (error) {
        console.log("Repository findByEmail error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching user."
        };
    }
}

/**
 * Issue a fresh password-reset token for a user, discarding any earlier
 * unused ones so a user only ever has one valid link at a time.
 */
export async function createResetToken(userId: number, token: string, expiresAt: Date) {
    try {
        await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
        // Store only the hash — the raw token lives solely in the emailed URL.
        return await prisma.passwordResetToken.create({
            data: { userId, token: hashResetToken(token), expiresAt },
            // No caller reads the row; never hand back the stored token hash.
            select: { id: true },
        });
    } catch (error) {
        console.log("Repository createResetToken error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error creating reset token."
        };
    }
}

/** A token that hasn't been used yet and hasn't expired, with its user. */
export async function findValidResetToken(token: string) {
    try {
        // Look up by the hash of the presented token — never the token itself.
        // The nested user select excludes password; callers only ever read
        // userId/id off the token row itself, but the relation is kept (id
        // only) since it's part of the established return shape.
        return await prisma.passwordResetToken.findFirst({
            where: { token: hashResetToken(token), usedAt: null, expiresAt: { gt: new Date() } },
            include: { user: { select: { id: true } } },
        });
    } catch (error) {
        console.log("Repository findValidResetToken error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching reset token."
        };
    }
}

export async function markResetTokenUsed(id: number) {
    try {
        return await prisma.passwordResetToken.update({
            where: { id },
            data: { usedAt: new Date() },
            select: { id: true },
        });
    } catch (error) {
        console.log("Repository markResetTokenUsed error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating reset token."
        };
    }
}

export async function updatePassword(userId: number, hashedPassword: string) {
    try {
        return await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
            // No caller reads the row; never hand back the password hash.
            select: { id: true },
        });
    } catch (error) {
        console.log("Repository updatePassword error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating password."
        };
    }
}

/**
 * Set which projects a user is assigned to — touching ONLY the assignments
 * this screen is entitled to edit.
 *
 * The editable set is read from the database, never trusted from the payload:
 * the projects that are live AND whose company is live (the ones the
 * assignment screen offers). The resulting assignments are
 *
 *   (existing assignments OUTSIDE the editable set)  U  (submitted ids INSIDE it)
 *
 * so a tampered payload still cannot link a trashed project or an id that
 * does not exist — and saving no longer erases an assignment the screen never
 * displayed: a project in the trash (or under a company in the trash) keeps
 * its assignees, so restoring it gives the user their access back. Same rule
 * as setContactProjects, which this mirrors.
 * Only consulted when the user's job function scope is ASSIGNED, but stored
 * regardless so switching the function on doesn't lose the assignments.
 */
export async function setUserProjects(userId: number, projectIds: number[]) {
    try {
        return await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { assignedProjects: { select: { id: true } } },
            });
            const existingIds = user.assignedProjects.map((p) => p.id);
            const editable = await tx.project.findMany({
                where: {
                    id: { in: [...new Set([...existingIds, ...projectIds])] },
                    deletedAt: null,
                    client: { deletedAt: null },
                },
                select: { id: true },
            });
            const editableIds = new Set(editable.map((p) => p.id));
            const kept = existingIds.filter((id) => !editableIds.has(id));
            const submitted = projectIds.filter((id) => editableIds.has(id));
            const finalIds = [...new Set([...kept, ...submitted])];
            return tx.user.update({
                where: { id: userId },
                data: { assignedProjects: { set: finalIds.map((id) => ({ id })) } },
                select: { id: true },
            });
        });
    } catch (error) {
        console.log("Repository setUserProjects error:", error);
        throw { type: "repositoryError", message: "Database Error assigning projects." };
    }
}

/** How many accounts hold this job function (any role). */
export async function countHolders(jobFunctionId: number): Promise<number> {
    try {
        return await prisma.user.count({ where: { jobFunctionId } });
    } catch (error) {
        console.log("Repository countHolders error:", error);
        throw { type: "repositoryError", message: "Database Error counting function holders." };
    }
}

/** The ids of the job functions held by at least one account — one query, for the functions screen. */
export async function findHeldFunctionIds(): Promise<number[]> {
    try {
        const rows = await prisma.user.findMany({
            where: { jobFunctionId: { not: null } },
            select: { jobFunctionId: true },
            distinct: ["jobFunctionId"],
        });
        return rows.flatMap((r) => (r.jobFunctionId === null ? [] : [r.jobFunctionId]));
    } catch (error) {
        console.log("Repository findHeldFunctionIds error:", error);
        throw { type: "repositoryError", message: "Database Error listing function holders." };
    }
}
