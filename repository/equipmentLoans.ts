import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

type EquipmentLoanCreateData = {
    equipmentId: number;
    borrowerId: number;
    lentAt: string;
    dueAt?: string;
    note?: string;
};

/**
 * `EquipmentLoan` carries exactly one unique constraint — the partial index
 * `EquipmentLoan_equipmentId_open_key` (migration 20260918120000) — so any
 * P2002 on this table can only be that "already lent" conflict. Checked two
 * ways because Prisma/Postgres commonly reports `meta.target` as the bare
 * column array (`["equipmentId"]`), not the index name — a string target
 * (when the driver does provide the index name) is still matched too, rather
 * than treating every P2002 as this one conflict by assumption: a future
 * second unique constraint on this table must not get silently
 * misattributed. No `target` at all still counts, since this is the table's
 * only unique constraint.
 *
 * ⚠️ Verified live against this project's own database (temporary probe, not
 * committed): with the Postgres driver adapter this app actually uses
 * (`@prisma/adapter-pg`, lib/prisma.ts), `meta.target` is NOT populated at
 * all for this constraint — the real column list is nested instead, under
 * the undocumented `meta.driverAdapterError.cause.constraint.fields`, and
 * the index name only appears inside `meta.driverAdapterError.cause.originalMessage`.
 * So today, every P2002 on this table falls through to the `no target info`
 * branch below, not either of the two matched shapes — flagged for
 * arbitration rather than parsed here, since that structure is an
 * implementation detail of the adapter, not Prisma's documented `target`
 * contract, and could change silently on an adapter version bump.
 */
function isOpenLoanConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.includes("equipmentId");
    if (typeof target === "string") return target.includes("EquipmentLoan_equipmentId_open_key");
    return true;
}

/**
 * Create a loan. "Already lent" can ONLY be detected here, on the P2002 the
 * partial unique index raises — NEVER on an application-side pre-check
 * findFirst, which two concurrent requests would both pass; only the
 * database can refuse the second one atomically. Never lets the raw Prisma
 * error escape: translated into a plain `{ type: "error", i18n: "alreadyLent" }`
 * the action layer can relay through getErrorMessage like any other app-thrown
 * i18n code (lib/helpers.ts), or into the usual generic repositoryError for
 * any other failure.
 */
export async function create(data: EquipmentLoanCreateData) {
    try {
        return await prisma.equipmentLoan.create({
            data: {
                equipmentId: data.equipmentId,
                borrowerId: data.borrowerId,
                lentAt: new Date(data.lentAt),
                dueAt: data.dueAt ? new Date(data.dueAt) : null,
                note: data.note ?? null,
            },
        });
    } catch (error) {
        if (isOpenLoanConflict(error)) {
            throw { type: "error", message: "This equipment is already lent out.", i18n: "alreadyLent" };
        }
        console.log("Repository create (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error creating loan." };
    }
}

/**
 * A single loan, projected for the action layer's authorization + date-order
 * checks: equipmentId/borrowerId identify the row, returnedAt says whether
 * it's still open, equipment.ownerId is what "owner or admin" is checked
 * against, and lentAt is the floor a new dueAt/returnedAt must not precede
 * (schemas/equipmentLoan.ts can't enforce that itself — lentAt isn't part of
 * the edit/return payload, only the create one).
 */
export async function findById(id: number) {
    try {
        return await prisma.equipmentLoan.findUnique({
            where: { id },
            select: {
                id: true,
                equipmentId: true,
                borrowerId: true,
                lentAt: true,
                returnedAt: true,
                equipment: { select: { ownerId: true } },
            },
        });
    } catch (error) {
        console.log("Repository findById (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching loan." };
    }
}

/**
 * Mark a loan returned — idempotent-safe: the WHERE clause re-checks
 * `returnedAt: null` at the moment of the write, in the SAME statement, not
 * just at an earlier read in the action. Decision A lets both the
 * equipment's owner/admin AND the borrower record a return, so two
 * concurrent submissions racing each other must not both succeed. Returns
 * the number of rows updated (0 or 1, `id` is a primary key) rather than the
 * row itself, so the caller can tell "already closed by someone else, right
 * now" apart from "updated" without a second read.
 */
export async function markReturned(id: number, returnedAt: string): Promise<number> {
    try {
        const result = await prisma.equipmentLoan.updateMany({
            where: { id, returnedAt: null },
            data: { returnedAt: new Date(returnedAt) },
        });
        return result.count;
    } catch (error) {
        console.log("Repository markReturned (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error returning loan." };
    }
}

type EquipmentLoanUpdateData = { dueAt?: string; note?: string };

export async function update(id: number, data: EquipmentLoanUpdateData) {
    try {
        return await prisma.equipmentLoan.update({
            where: { id },
            data: {
                dueAt: data.dueAt ? new Date(data.dueAt) : null,
                note: data.note ?? null,
            },
        });
    } catch (error) {
        console.log("Repository update (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error updating loan." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.equipmentLoan.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting loan." };
    }
}

export type EquipmentLoanHistoryFilter = {
    ownerId?: number;
    borrowerId?: number;
    all?: boolean;
    take?: number;
    /**
     * Which side of the open/closed line to read. Lives in the query — not
     * in a JS filter after the fact — because `take` bounds the ROWS RETURNED,
     * and bounding 500 loans by lentAt and then keeping the open ones would
     * silently drop the oldest open loans (the most overdue, the very ones an
     * admin looks for) past the 500 most recent of ALL loans (delta audit,
     * Medium). Omitted = both.
     */
    status?: "open" | "returned";
};

/**
 * Loan history, most recent first. `all` (admin) returns every loan;
 * otherwise `ownerId`/`borrowerId` scope to "what I lent" / "what was lent
 * to me" (either or both — a caller may want the union of the two for their
 * own "my loans" view). Passing neither a filter nor `all` returns an empty
 * list rather than the whole table, so a caller can't get everything by
 * simply forgetting to scope the call. `take` matters for `all` (unbounded
 * otherwise — app/loans/page.tsx passes a shared ceiling); the owner/borrower
 * scoped calls are already naturally bounded by one person's own loans.
 */
export async function findHistory(filter: EquipmentLoanHistoryFilter) {
    try {
        const ownerFilter = filter.ownerId !== undefined ? { equipment: { ownerId: filter.ownerId } } : null;
        const borrowerFilter = filter.borrowerId !== undefined ? { borrowerId: filter.borrowerId } : null;
        const scope = filter.all
            ? {}
            : ownerFilter && borrowerFilter
              ? { OR: [ownerFilter, borrowerFilter] }
              : (ownerFilter ?? borrowerFilter);
        if (!scope) return [];
        const statusFilter =
            filter.status === "open" ? { returnedAt: null } : filter.status === "returned" ? { returnedAt: { not: null } } : {};
        const where = { ...scope, ...statusFilter };

        return await prisma.equipmentLoan.findMany({
            where,
            select: {
                id: true,
                lentAt: true,
                dueAt: true,
                returnedAt: true,
                note: true,
                equipment: {
                    select: { id: true, name: true, reference: true, owner: { select: { id: true, name: true } } },
                },
                borrower: { select: { id: true, name: true } },
            },
            orderBy: { lentAt: "desc" },
            ...(filter.take !== undefined ? { take: filter.take } : {}),
        });
    } catch (error) {
        console.log("Repository findHistory (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching loan history." };
    }
}
