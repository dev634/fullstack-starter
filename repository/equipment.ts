import { prisma } from "@/lib/prisma";

type EquipmentData = {
    ownerId: number;
    name: string;
    reference?: string;
    photoUrl?: string | null;
    photoPublicId?: string | null;
};

/**
 * Every open loan's fields the "Prêts" list/detail views need, nested under
 * an equipment row. `where: { returnedAt: null }` means at most one row
 * comes back per equipment — the same invariant the partial unique index
 * `EquipmentLoan_equipmentId_open_key` enforces in the database (migration
 * 20260918120000) — but this is a plain filtered include, not a reliance on
 * that index; it would still return at most one row even without it, given
 * the invariant genuinely holds.
 */
const OPEN_LOAN_SELECT = {
    where: { returnedAt: null },
    select: {
        id: true,
        borrowerId: true,
        lentAt: true,
        dueAt: true,
        borrower: { select: { id: true, name: true } },
    },
} as const;

/**
 * Shared projection for the two list reads below (findOwned/findAll) — kept
 * in one place so "my catalogue" and "every catalogue" (admin) never drift
 * into showing different columns. `User` carries a password hash, so every
 * relation here is a `select`, never a bare `include`.
 */
const EQUIPMENT_LIST_SELECT = {
    id: true,
    name: true,
    reference: true,
    photoUrl: true,
    ownerId: true,
    owner: { select: { id: true, name: true } },
    createdAt: true,
    loans: OPEN_LOAN_SELECT,
} as const;

export async function create(data: EquipmentData) {
    try {
        return await prisma.equipment.create({
            data: {
                ownerId: data.ownerId,
                name: data.name,
                reference: data.reference ?? null,
                photoUrl: data.photoUrl ?? null,
                photoPublicId: data.photoPublicId ?? null,
            },
            select: EQUIPMENT_LIST_SELECT,
        });
    } catch (error) {
        console.log("Repository create (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error creating equipment." };
    }
}

type EquipmentUpdateData = {
    name: string;
    reference?: string;
    /** `undefined` = leave the photo untouched; `null` = clear the pair;
     * a string = the new upload's field. Always written together with
     * photoPublicId — see the CHECK on Equipment_photo_pair_check. */
    photoUrl?: string | null;
    photoPublicId?: string | null;
};

export async function update(id: number, data: EquipmentUpdateData) {
    try {
        return await prisma.equipment.update({
            where: { id },
            data: {
                name: data.name,
                reference: data.reference ?? null,
                ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl, photoPublicId: data.photoPublicId } : {}),
            },
            select: EQUIPMENT_LIST_SELECT,
        });
    } catch (error) {
        console.log("Repository update (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error updating equipment." };
    }
}

/**
 * A single equipment row, projected for the action layer's own needs: the
 * ownership check (ownerId), and the photo pair to diff/destroy on edit or
 * delete (photoUrl/photoPublicId) — not part of the enumerated exports this
 * repository was scoped to, but required to implement the photo-replace
 * mechanic ("upload replaces, destroy the previous one after a successful
 * write") the same way actions/clients/clients.ts::updateClient does via its
 * own findById. Never a bare `include`/whole-row select: User isn't even
 * joined here.
 */
export async function findById(id: number) {
    try {
        return await prisma.equipment.findUnique({
            where: { id },
            select: { id: true, ownerId: true, name: true, reference: true, photoUrl: true, photoPublicId: true },
        });
    } catch (error) {
        console.log("Repository findById (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching equipment." };
    }
}

/** The equipment's real owner id, or null if it doesn't exist — the
 * resolved-in-the-database id every mutation on it must authorize against,
 * never one taken from a form field (docs/CONVENTIONS.md). */
export async function findOwnerId(id: number): Promise<number | null> {
    try {
        const equipment = await prisma.equipment.findUnique({ where: { id }, select: { ownerId: true } });
        return equipment?.ownerId ?? null;
    } catch (error) {
        console.log("Repository findOwnerId (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching equipment owner." };
    }
}

/** A user's own catalogue, most recently added first. */
export async function findOwned(ownerId: number) {
    try {
        return await prisma.equipment.findMany({
            where: { ownerId },
            select: EQUIPMENT_LIST_SELECT,
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findOwned (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching equipment." };
    }
}

/** Every user's catalogue — admin view only, gated by the action layer. */
export async function findAll() {
    try {
        return await prisma.equipment.findMany({
            select: EQUIPMENT_LIST_SELECT,
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findAll (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching equipment." };
    }
}

/**
 * Delete an equipment IF it isn't currently lent out — in ONE statement, so
 * the "not lent" check and the delete can't race against a loan created in
 * between (the migration's own reasoning for not doing a read-then-write
 * here). `ownerId: null` means "admin" — no ownership filter, matching every
 * row; a non-null value scopes the delete to that owner's own row, so a
 * non-admin caller targeting someone else's equipment simply deletes 0 rows,
 * which the action layer reads exactly like "not found" (anti-enumeration).
 * Returns the number of rows actually deleted (0 or 1).
 */
export async function removeIfNotLent(id: number, ownerId: number | null): Promise<number> {
    try {
        const result = await prisma.equipment.deleteMany({
            where: {
                id,
                ...(ownerId !== null ? { ownerId } : {}),
                loans: { none: { returnedAt: null } },
            },
        });
        return result.count;
    } catch (error) {
        console.log("Repository removeIfNotLent (equipment) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting equipment." };
    }
}
