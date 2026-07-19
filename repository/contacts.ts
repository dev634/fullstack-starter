import { prisma } from "@/lib/prisma";

/** Contacts of a client — primary first, then oldest first. */
export async function findByClient(clientId: number) {
    try {
        return await prisma.contact.findMany({
            where: { clientId },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        });
    } catch (error) {
        console.log("Repository findByClient (contact) error:", error);
        throw { type: "error", message: "Database Error fetching contacts." };
    }
}

/**
 * Every contact of a non-trashed organisation, each with its org's email
 * (the link column used by the CSV export/import). Grouped by organisation,
 * primary first.
 */
export async function findAllWithClientEmail() {
    try {
        return await prisma.contact.findMany({
            where: { client: { deletedAt: null } },
            orderBy: [{ clientId: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
            include: { client: { select: { email: true } } },
        });
    } catch (error) {
        console.log("Repository findAllWithClientEmail (contact) error:", error);
        throw { type: "error", message: "Database Error fetching contacts." };
    }
}

type ContactData = {
    clientId: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    role?: string;
    isPrimary?: boolean;
};

/**
 * Adds a contact to a client. The client's first contact — or one explicitly
 * flagged — becomes the sole primary, demoting any previous primary in the
 * same transaction so there's never more than one.
 */
export async function create(data: ContactData) {
    try {
        return await prisma.$transaction(async (tx) => {
            const count = await tx.contact.count({ where: { clientId: data.clientId } });
            const primary = data.isPrimary ?? count === 0;
            if (primary) {
                await tx.contact.updateMany({ where: { clientId: data.clientId }, data: { isPrimary: false } });
            }
            return tx.contact.create({
                data: {
                    clientId: data.clientId,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    email: data.email || null,
                    phone: data.phone || null,
                    role: data.role || null,
                    isPrimary: primary,
                },
            });
        });
    } catch (error) {
        console.log("Repository create contact error:", error);
        throw { type: "error", message: "Database Error creating contact." };
    }
}

type ContactUpdateData = {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    role?: string;
};

/** Edits a contact's own fields — never its primary flag (see setPrimary). */
export async function update(id: number, data: ContactUpdateData) {
    try {
        return await prisma.contact.update({
            where: { id },
            data: {
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email || null,
                phone: data.phone || null,
                role: data.role || null,
            },
        });
    } catch (error) {
        console.log("Repository update contact error:", error);
        throw { type: "error", message: "Database Error updating contact." };
    }
}

/** Makes a contact its client's sole primary (scoped by clientId so a stray id can't touch another client). */
export async function setPrimary(id: number, clientId: number) {
    try {
        return await prisma.$transaction([
            prisma.contact.updateMany({ where: { clientId }, data: { isPrimary: false } }),
            prisma.contact.updateMany({ where: { id, clientId }, data: { isPrimary: true } }),
        ]);
    } catch (error) {
        console.log("Repository setPrimary contact error:", error);
        throw { type: "error", message: "Database Error updating primary contact." };
    }
}

/** Deletes a contact; if it was the primary, promotes the oldest remaining contact so the client keeps one. */
export async function remove(id: number) {
    try {
        return await prisma.$transaction(async (tx) => {
            const contact = await tx.contact.delete({ where: { id } });
            if (contact.isPrimary) {
                const next = await tx.contact.findFirst({
                    where: { clientId: contact.clientId },
                    orderBy: { createdAt: "asc" },
                });
                if (next) await tx.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
            }
            return contact;
        });
    } catch (error) {
        console.log("Repository remove contact error:", error);
        throw { type: "error", message: "Database Error deleting contact." };
    }
}
