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
 * Create a loan. Deliberately does NOT translate a P2002 into a friendlier
 * shape the way repository/users.ts::create does for a duplicate email: the
 * partial unique index `EquipmentLoan_equipmentId_open_key` (migration
 * 20260918120000) is the ONLY safe way to detect "already lent" — two
 * concurrent requests can both pass an application-side pre-check, only the
 * database can refuse the second one atomically — so the action layer needs
 * the raw Prisma error (its `code` and `meta.target`) to tell that specific
 * conflict apart from any other failure. Any OTHER error is still wrapped in
 * the usual repositoryError shape.
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
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw error;
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

export async function markReturned(id: number, returnedAt: string) {
    try {
        return await prisma.equipmentLoan.update({
            where: { id },
            data: { returnedAt: new Date(returnedAt) },
        });
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

/** Every loan currently out to a borrower — "what's been lent to me". */
export async function findOpenByBorrower(borrowerId: number) {
    try {
        return await prisma.equipmentLoan.findMany({
            where: { borrowerId, returnedAt: null },
            select: {
                id: true,
                lentAt: true,
                dueAt: true,
                note: true,
                equipment: { select: { id: true, name: true, reference: true, owner: { select: { id: true, name: true } } } },
            },
            orderBy: { lentAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findOpenByBorrower (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching loans." };
    }
}

export type EquipmentLoanHistoryFilter = { ownerId?: number; borrowerId?: number; all?: boolean };

/**
 * Loan history, most recent first. `all` (admin) returns every loan;
 * otherwise `ownerId`/`borrowerId` scope to "what I lent" / "what was lent
 * to me" (either or both — a caller may want the union of the two for their
 * own "my loans" view). Passing neither a filter nor `all` returns an empty
 * list rather than the whole table, so a caller can't get everything by
 * simply forgetting to scope the call.
 */
export async function findHistory(filter: EquipmentLoanHistoryFilter) {
    try {
        const ownerFilter = filter.ownerId !== undefined ? { equipment: { ownerId: filter.ownerId } } : null;
        const borrowerFilter = filter.borrowerId !== undefined ? { borrowerId: filter.borrowerId } : null;
        const where = filter.all
            ? {}
            : ownerFilter && borrowerFilter
              ? { OR: [ownerFilter, borrowerFilter] }
              : (ownerFilter ?? borrowerFilter);
        if (!where) return [];

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
        });
    } catch (error) {
        console.log("Repository findHistory (equipmentLoan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching loan history." };
    }
}
