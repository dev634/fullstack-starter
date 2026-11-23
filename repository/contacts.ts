import { prisma } from "@/lib/prisma";
import { sessionAccountWhere } from "@/repository/users";

/** Contacts of a client — primary first, then oldest first. Explicit `select`,
 * limited to what the contact list screen (components/ContactRow.tsx) reads:
 * the contact's own fields, its job function name, the ids of its linked
 * projects (the page narrows them to the ones the caller may edit before
 * they reach the browser) and `userId` (only to know whether it has a portal
 * login — the login's own email and role are not read). */
export async function findByClient(clientId: number) {
    try {
        return await prisma.contact.findMany({
            where: { clientId },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                isPrimary: true,
                jobFunctionId: true,
                userId: true,
                jobFunction: { select: { name: true } },
                projects: { select: { id: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByClient (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching contacts." };
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
            where: { user: sessionAccountWhere(email) },
            include: {
                projects: { select: { id: true } },
                client: { select: { id: true, companyName: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByUserEmail (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching portal contact." };
    }
}

/** A single contact by id (raw row) — used by the portal-login action. */
export async function findById(id: number) {
    try {
        return await prisma.contact.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching contact." };
    }
}

/**
 * Ids of EVERY project the contact is linked to, trashed ones included — the
 * input of lib/contactPolicy.ts::canRemoveContact. Minimal `select`.
 * `null` = no such contact, NOT "no links": an empty list means "nothing to
 * lose" and authorizes a deletion, which an absent contact must never do.
 */
export async function findLinkedProjectIds(contactId: number): Promise<number[] | null> {
    try {
        const row = await prisma.contact.findUnique({
            where: { id: contactId },
            select: { projects: { select: { id: true } } },
        });
        return row ? row.projects.map((p) => p.id) : null;
    } catch (error) {
        console.log("Repository findLinkedProjectIds (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching contact links." };
    }
}

/** Attach a portal login (User id) to a contact. */
export async function attachLogin(contactId: number, userId: number) {
    try {
        return await prisma.contact.update({ where: { id: contactId }, data: { userId } });
    } catch (error) {
        console.log("Repository attachLogin (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error attaching login." };
    }
}

/**
 * Set which of the contact's own company projects its portal login may see —
 * touching ONLY the links the caller is entitled to edit.
 *
 * The editable set is computed here, from the database, never read from the
 * form: the LIVE projects of the contact's own company that sit inside the
 * caller's scope (`scopeProjectIds`: `projectIdFilter(await
 * getAccessContext())`, `undefined` = unrestricted). The resulting links are
 *
 *   (existing links OUTSIDE the editable set)  U  (submitted ids INSIDE it)
 *
 * so a restricted caller's save cannot erase a link to a project it never saw
 * (outside its scope, or in the trash — the form only lists its own live
 * projects), nor create one to a project it cannot reach or to another
 * company's. The parameter is required on purpose (no default): a caller must
 * say which scope it writes under.
 */
export async function setContactProjects(
    contactId: number,
    projectIds: number[],
    scopeProjectIds: number[] | undefined
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const contact = await tx.contact.findUniqueOrThrow({
                where: { id: contactId },
                select: { clientId: true, projects: { select: { id: true } } },
            });
            const editable = await tx.project.findMany({
                where: {
                    clientId: contact.clientId,
                    deletedAt: null,
                    ...(scopeProjectIds !== undefined ? { id: { in: scopeProjectIds } } : {}),
                },
                select: { id: true },
            });
            const editableIds = new Set(editable.map((p) => p.id));
            const kept = contact.projects.map((p) => p.id).filter((id) => !editableIds.has(id));
            const submitted = projectIds.filter((id) => editableIds.has(id));
            const finalIds = [...new Set([...kept, ...submitted])];
            return tx.contact.update({
                where: { id: contactId },
                data: { projects: { set: finalIds.map((id) => ({ id })) } },
                select: { id: true },
            });
        });
    } catch (error) {
        console.log("Repository setContactProjects error:", error);
        throw { type: "repositoryError", message: "Database Error linking projects." };
    }
}

/**
 * Every contact of a non-trashed organisation, each with its org's email
 * (the link column used by the CSV export/import). Grouped by organisation,
 * primary first.
 *
 * `projectIds`, when given, scopes the result to organisations reachable
 * through one of those projects — the same reachability rule as
 * repository/clients.ts::search, applied here so a restricted caller's CSV
 * export can't pull contacts (personal data: email/phone) belonging to a
 * company outside their scope. An EMPTY allowlist yields no contact at all
 * (presence check on the parameter, never a truthiness one — see
 * repository/clients.ts::search for why). `undefined` means unrestricted.
 *
 * `select` is explicit and limited to exactly the columns the CSV export
 * uses — Contact carries personal fields (email/phone), so this never leaks
 * more than the export needs (e.g. the internal `userId` portal-login link).
 */
export async function findAllWithClientEmail(projectIds?: number[]) {
    try {
        return await prisma.contact.findMany({
            where: {
                client: {
                    deletedAt: null,
                    ...(projectIds !== undefined
                        ? { projects: { some: { id: { in: projectIds }, deletedAt: null } } }
                        : {}),
                },
            },
            orderBy: [{ clientId: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                isPrimary: true,
                client: { select: { email: true } },
                jobFunction: { select: { name: true } },
            },
            // Bounded like the other bulk exports in this codebase — an unbounded
            // findMany here would load every contact row into memory at once.
            take: 10000,
        });
    } catch (error) {
        console.log("Repository findAllWithClientEmail (contact) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching contacts." };
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
        throw { type: "repositoryError", message: "Database Error creating contact." };
    }
}

// A PARTIAL write: absent = leave the column alone, null = clear it, a value
// sets it (lib/partialWrite.ts, tests/repository-partial-write.test.ts).
type ContactUpdateData = {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
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
                email: data.email,
                phone: data.phone,
                jobFunctionId: data.jobFunctionId,
            },
            select: { id: true },
        });
    } catch (error) {
        console.log("Repository update contact error:", error);
        throw { type: "repositoryError", message: "Database Error updating contact." };
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
        throw { type: "repositoryError", message: "Database Error updating primary contact." };
    }
}

/**
 * Deletes a contact; if it was the primary, promotes the oldest remaining
 * contact so the client keeps one. Also deletes its portal login (if any),
 * but ONLY while that account is still a CLIENT: a login promoted to a
 * higher role is an internal account now, and deleting a contact (a
 * content.edit action) must never be a way to delete an ADMIN — the account
 * is left alone (Contact.userId is SetNull, the contact row is gone anyway).
 * A Contact.userId is 1:1 and exists only to authenticate as this contact, so
 * leaving it behind after the contact is gone would let a revoked contact
 * keep signing in indefinitely (the account just fails to resolve a portal
 * scope; it stays otherwise fully authenticatable).
 */
export async function remove(id: number) {
    try {
        return await prisma.$transaction(async (tx) => {
            const contact = await tx.contact.delete({
                where: { id },
                select: { userId: true, isPrimary: true, clientId: true },
            });
            if (contact.userId) {
                await tx.user.deleteMany({ where: { id: contact.userId, role: "CLIENT" } });
            }
            if (contact.isPrimary) {
                const next = await tx.contact.findFirst({
                    where: { clientId: contact.clientId },
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                });
                if (next) await tx.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
            }
            return { id };
        });
    } catch (error) {
        console.log("Repository remove contact error:", error);
        throw { type: "repositoryError", message: "Database Error deleting contact." };
    }
}
