import { prisma } from "@/lib/prisma";

/** Contacts of a client — primary first, then oldest first. Includes each
 * contact's job function (name), its linked project ids, and its portal login
 * (if any) for the contact management UI. */
export async function findByClient(clientId: number) {
    try {
        return await prisma.contact.findMany({
            where: { clientId },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            include: {
                jobFunction: { select: { id: true, name: true } },
                projects: { select: { id: true } },
                user: { select: { id: true, email: true, role: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByClient (contact) error:", error);
        throw { type: "error", message: "Database Error fetching contacts." };
    }
}

/**
 * The contact tied to a client-portal login (matched by the login's email),
 * with the ids of the projects it may see and its company. Drives all portal
 * scoping — a CLIENT session resolves to exactly this set and nothing else.
 */
export async function findByUserEmail(email: string) {
    try {
        return await prisma.contact.findFirst({
            where: { user: { email } },
            include: {
                projects: { select: { id: true } },
                client: { select: { id: true, companyName: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByUserEmail (contact) error:", error);
        throw { type: "error", message: "Database Error fetching portal contact." };
    }
}

/** A single contact by id (raw row) — used by the portal-login action. */
export async function findById(id: number) {
    try {
        return await prisma.contact.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (contact) error:", error);
        throw { type: "error", message: "Database Error fetching contact." };
    }
}

/** Attach a portal login (User id) to a contact. */
export async function attachLogin(contactId: number, userId: number) {
    try {
        return await prisma.contact.update({ where: { id: contactId }, data: { userId } });
    } catch (error) {
        console.log("Repository attachLogin (contact) error:", error);
        throw { type: "error", message: "Database Error attaching login." };
    }
}

/**
 * Set which of the contact's own company projects its portal login may see.
 * `projectIds` is filtered to projects that actually belong to the contact's
 * client, so a tampered payload can't link a project from another company.
 */
export async function setContactProjects(contactId: number, projectIds: number[]) {
    try {
        return await prisma.$transaction(async (tx) => {
            const contact = await tx.contact.findUniqueOrThrow({
                where: { id: contactId },
                select: { clientId: true },
            });
            const valid = await tx.project.findMany({
                where: { id: { in: projectIds }, clientId: contact.clientId, deletedAt: null },
                select: { id: true },
            });
            return tx.contact.update({
                where: { id: contactId },
                data: { projects: { set: valid.map((p) => ({ id: p.id })) } },
            });
        });
    } catch (error) {
        console.log("Repository setContactProjects error:", error);
        throw { type: "error", message: "Database Error linking projects." };
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
            include: {
                client: { select: { email: true } },
                jobFunction: { select: { name: true } },
            },
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
    jobFunctionId?: number | null;
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
                    jobFunctionId: data.jobFunctionId ?? null,
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
    jobFunctionId?: number | null;
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
                jobFunctionId: data.jobFunctionId ?? null,
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
